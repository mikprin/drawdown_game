import { LIFTS, MARKET, OFFSHORE, TERMINAL } from './balance';
import { addLog } from './log';
import { isSelling, salePrice } from './market';
import { msg } from './msg';
import { emptyPlatformFlows } from './newGame';
import { chokeWells, wellPotentials } from './plant';
import {
  legDays, modulesOpex, moduleValue, platformLive, stormy, tankerDest,
} from './platform';
import { fieldById, fieldWells, wellOpex } from './reservoir';
import { randRange } from './rng';
import type { GameState, Platform, PlatformFlows, Tanker, TerminalFlows, WellFlow } from './types';

/** The shelf part of a simulation step: weather, platform plants, tankers, decommissioning. */

export function updateWeather(s: GameState, dt: number): void {
  if (!s.shelf) return;
  const w = s.weather;
  if (w.storm > 0) {
    w.storm -= dt;
    if (w.storm <= 0) {
      w.storm = 0;
      addLog(s, msg('log.stormOver'));
    }
    return;
  }
  w.next -= dt;
  if (!w.warned && w.next <= OFFSHORE.stormWarnDays) {
    w.warned = true;
    addLog(s, msg('log.stormWarn', { days: Math.max(1, Math.ceil(w.next)) }), 'bad');
  }
  if (w.next <= 0) {
    w.storm = randRange(s, OFFSHORE.stormDays[0], OFFSHORE.stormDays[1]);
    w.next = randRange(s, OFFSHORE.stormGap[0], OFFSHORE.stormGap[1]);
    w.warned = false;
    addLog(s, msg('log.storm', { days: Math.round(w.storm) }), 'bad');
  }
}

/** Decommissioning countdown. Weather stops the work like everything else at sea. */
export function advancePlatforms(s: GameState, dt: number): void {
  if (stormy(s)) return;
  for (const p of [...s.platforms]) {
    if (!p.decom) continue;
    p.decom.daysLeft -= dt;
    if (p.decom.daysLeft > 0) continue;
    // Anything still aboard a tanker is sold on the spot.
    for (const t of p.tankers) if (t.cargo > 0) sellCargo(s, p, t);
    s.platforms = s.platforms.filter((x) => x !== p);
    addLog(s, msg('log.decomDone', { field: fieldById(s, p.fieldId).name }), 'good');
  }
}

export function computePlatformFlows(s: GameState, p: Platform, dt: number, wellsOut: Record<number, WellFlow>): PlatformFlows {
  const pf = emptyPlatformFlows();
  pf.storageCap = moduleValue(p, 'storage');
  pf.revenue = p.revenueEma;
  if (!platformLive(s, p)) {
    // Under construction there are no running costs yet; during decommissioning only laden tankers stay on charter.
    if (p.decom) pf.costs.charter = p.tankers.length * OFFSHORE.tankerCharterDay;
    pf.costTotal = pf.costs.charter ?? 0;
    pf.profit = pf.revenue - pf.costTotal;
    return pf;
  }
  const storm = stormy(s);
  const wells = fieldWells(s, p.fieldId);
  const injectors = wells.filter((w) => w.status === 'injector' && !w.job);
  pf.sepCap = moduleValue(p, 'separator');
  pf.injCap = Math.min(moduleValue(p, 'injection'), injectors.length * OFFSHORE.injectivity);
  pf.waterTreatCap = moduleValue(p, 'waterTreat');
  pf.waterCap = pf.injCap + pf.waterTreatCap;
  pf.turbineCap = moduleValue(p, 'turbine');
  pf.gasInjCap = moduleValue(p, 'gasInj');

  const moored = p.tankers.find((t) => t.state === 'moored');
  const loadable = moored && !storm ? Math.min(OFFSHORE.loadRate * dt, OFFSHORE.tankerCargo - moored.cargo) : 0;
  const oilRoom = Math.max(0, pf.storageCap - p.storage + loadable) / dt;

  const { pots, potential, liftLimited } = wellPotentials(s, wells);
  pf.liquidPotential = potential;
  pf.liftLimitedWells = liftLimited;
  pf.bottleneck = chokeWells(pots, pf.sepCap, pf.waterCap, oilRoom, s.techs.scada);

  let liftPower = 0;
  for (const pt of pots) {
    pt.fl.gas = (pt.fl.oil * pt.gor) / 1000;
    pf.liquid += pt.fl.liquid; pf.oil += pt.fl.oil; pf.water += pt.fl.water; pf.gas += pt.fl.gas;
    liftPower += pt.fl.liquid * LIFTS[pt.w.lift].powerPerBbl * OFFSHORE.powerMult;
    wellsOut[pt.w.id] = pt.fl;
  }
  pf.choke = pf.liquidPotential > 0 ? pf.liquid / pf.liquidPotential : 1;
  for (const w of injectors) {
    wellsOut[w.id] = { reservoir: 0, liftCap: 0, wc: 0, liquid: 0, oil: 0, water: 0, gas: 0, inj: pf.injCap / injectors.length };
  }
  pf.loaded = Math.min(loadable, p.storage + pf.oil * dt) / dt;

  // Water: re-injection first, then treatment and discharge overboard. Seawater tops up the injectors.
  pf.injected = pf.injCap;
  pf.injFromProduced = Math.min(pf.water, pf.injCap);
  pf.overboard = Math.min(pf.water - pf.injFromProduced, pf.waterTreatCap);
  const seawater = pf.injCap - pf.injFromProduced;

  // Power: diesel unless associated gas feeds the turbines. Leftover gas is re-injected, then flared.
  pf.powerDemand = OFFSHORE.basePowerDay + liftPower + pf.injected * OFFSHORE.injPowerPerBbl;
  pf.gasFuel = Math.min(pf.gas, pf.turbineCap, pf.powerDemand / OFFSHORE.fuelValuePerMcf);
  pf.gasInjected = Math.min(pf.gas - pf.gasFuel, pf.gasInjCap);
  pf.gasFlared = Math.max(0, pf.gas - pf.gasFuel - pf.gasInjected);

  let wellCost = 0;
  for (const w of wells) wellCost += wellOpex(s, w);
  pf.costs = {
    wellOpex: wellCost,
    facilities: modulesOpex(p) + pf.gasInjected * OFFSHORE.gasInjPerMcf,
    diesel: pf.powerDemand - pf.gasFuel * OFFSHORE.fuelValuePerMcf,
    water:
      pf.injFromProduced * OFFSHORE.injectionPerBbl +
      seawater * (OFFSHORE.injectionPerBbl + OFFSHORE.seawaterPerBbl) +
      pf.overboard * OFFSHORE.overboardPerBbl,
    flaring: pf.gasFlared * OFFSHORE.flarePerMcf,
    logistics: OFFSHORE.logisticsDay,
    charter: p.tankers.length * OFFSHORE.tankerCharterDay,
  };
  pf.costTotal = Object.values(pf.costs).reduce((a, b) => a + b, 0);
  pf.profit = pf.revenue - pf.costTotal;
  pf.value = pf.oil * salePrice(s);
  return pf;
}

export function applyPlatformFlows(s: GameState, p: Platform, pf: PlatformFlows, dt: number): void {
  let stock = p.storage + pf.oil * dt;
  const moored = p.tankers.find((t) => t.state === 'moored');
  if (moored && pf.loaded > 0) {
    const load = Math.min(pf.loaded * dt, stock);
    moored.cargo += load;
    stock -= load;
  }
  p.storage = Math.min(pf.storageCap, Math.max(0, stock));
  s.cash -= pf.costTotal * dt;
  s.stats.oilProduced += pf.oil * dt;
  const before = s.stats.revenue;
  updateTankers(s, p, dt);
  const sold = s.stats.revenue - before;
  p.revenueEma += (sold / dt - p.revenueEma) * (1 - Math.exp(-dt / OFFSHORE.revenueEmaDays));
}

function sellCargo(s: GameState, p: Platform, t: Tanker): void {
  const price = salePrice(s);
  const revenue = t.cargo * price;
  s.cash += revenue;
  s.market.impact = Math.min(MARKET.maxImpact, s.market.impact + t.cargo / OFFSHORE.marketDepth);
  s.stats.oilSold += t.cargo;
  s.stats.revenue += revenue;
  s.stats.cargoes++;
  addLog(s, msg('log.cargoSold', { field: fieldById(s, p.fieldId).name, bbl: t.cargo, cash: revenue }), 'good');
  t.cargo = 0;
}

function updateTankers(s: GameState, p: Platform, dt: number): void {
  const storm = stormy(s);
  for (const t of p.tankers) {
    switch (t.state) {
      case 'moored':
        if (storm) break;
        t.moored += dt;
        if (t.cargo >= OFFSHORE.tankerCargo - 1 || (t.moored >= OFFSHORE.maxMooredDays && t.cargo > 0)) {
          t.state = 'outbound';
          t.dest = tankerDest(s);
          t.daysLeft = legDays(s, p, t.dest);
        }
        break;
      case 'outbound':
        t.daysLeft -= dt;
        if (t.daysLeft <= 0) t.state = 'port';
        break;
      case 'port':
        if (t.dest === 'terminal' && s.terminal) {
          // Discharge into the terminal tanks; a full terminal keeps the tanker waiting alongside.
          const tm = s.terminal;
          const room = Math.max(0, TERMINAL.tanks[tm.tanks].value - tm.storage);
          const u = Math.min(t.cargo, room, TERMINAL.unloadRate * dt);
          tm.storage += u;
          t.cargo -= u;
          if (s.flows.terminal) s.flows.terminal.unloaded += u / dt;
          if (t.cargo > 0.5) break;
          t.cargo = 0;
          s.stats.cargoes++;
        } else {
          // Floor and Hold apply at sea too: the tanker waits in port for the price,
          // unless there is a terminal to divert to.
          if (!isSelling(s)) {
            if (s.terminal) {
              t.dest = 'terminal';
              t.state = 'outbound';
              t.daysLeft = OFFSHORE.legBase - TERMINAL.legBase;
            }
            break;
          }
          sellCargo(s, p, t);
        }
        t.state = 'inbound';
        t.daysLeft = legDays(s, p, t.dest);
        break;
      case 'inbound':
        t.daysLeft -= dt;
        if (t.daysLeft <= 0) t.state = 'queued';
        break;
      case 'queued':
        break;
    }
  }
  if (p.decom) {
    // A platform being removed keeps only the tankers that still carry its oil.
    p.tankers = p.tankers.filter((t) => t.cargo > 0);
    return;
  }
  if (!storm && !p.tankers.some((t) => t.state === 'moored')) {
    const q = p.tankers.find((t) => t.state === 'queued');
    if (q) {
      q.state = 'moored';
      q.moored = 0;
    }
  }
}

export function newTanker(s: GameState, p: Platform): Tanker {
  return { state: 'inbound', daysLeft: legDays(s, p), cargo: 0, moored: 0 };
}

// ---------- coastal terminal ----------

/** Terminal sales follow the market mode, like the onshore tank farm. */
export function computeTerminalFlows(s: GameState, dt: number): TerminalFlows | null {
  const tm = s.terminal;
  if (!tm) return null;
  const storageCap = TERMINAL.tanks[tm.tanks].value;
  const exportCap = TERMINAL.jetty[tm.jetty].value;
  const selling = isSelling(s);
  const overflow = !selling && s.market.sellMode === 'threshold' && !!s.market.sellWhenFull && tm.storage >= storageCap * 0.98;
  const sold = selling || overflow ? Math.min(exportCap * dt, tm.storage) / dt : 0;
  let waiting = 0;
  for (const p of s.platforms) for (const t of p.tankers) if (t.state === 'port' && t.dest === 'terminal' && tm.storage >= storageCap - 1) waiting++;
  const costs = { terminal: TERMINAL.tanks[tm.tanks].opexDay + TERMINAL.jetty[tm.jetty].opexDay + sold * TERMINAL.tariffPerBbl };
  const revenue = sold * salePrice(s);
  const costTotal = costs.terminal;
  return { storageCap, exportCap, sold, unloaded: 0, waiting, revenue, costs, costTotal, profit: revenue - costTotal };
}

export function applyTerminalFlows(s: GameState, tf: TerminalFlows, dt: number): void {
  const tm = s.terminal!;
  const vol = tf.sold * dt;
  tm.storage = Math.max(0, tm.storage - vol);
  s.cash += tf.profit * dt;
  s.market.impact = Math.min(MARKET.maxImpact, s.market.impact + vol / OFFSHORE.marketDepth);
  s.stats.oilSold += vol;
  s.stats.revenue += tf.revenue * dt;
}
