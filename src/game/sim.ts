import { ECON, EXPLORATION, FACILITIES, LIFTS, MARKET, RESERVOIR, TIME } from './balance';
import { FIELD_NAMES, emptyFlows, makeFieldFromLead, makeWell } from './newGame';
import { checkObjectives } from './objectives';
import {
  cap, exportCapacity, facilityOpex, fieldById, injectionCapacity, isProducing, liftCapacity,
  marketDepth, repairCost, reserveEstimate, reservoirLiquid, serviceCost, waterCut,
} from './reservoir';
import { rand, randNormal, randRange } from './rng';
import type { Bottleneck, FacilityId, Flows, GameState, LogKind, Well, WellFlow } from './types';
import { fmtBbl, fmtMoney } from './format';

export function addLog(s: GameState, text: string, kind: LogKind = 'info'): void {
  s.log.unshift({ day: s.day, text, kind });
  if (s.log.length > 80) s.log.length = 80;
}

export function salePrice(s: GameState): number {
  return s.market.price * (1 - s.market.impact);
}

export function isSelling(s: GameState): boolean {
  const m = s.market;
  return m.sellMode === 'auto' || (m.sellMode === 'threshold' && salePrice(s) >= m.threshold);
}

/** Advance the world by dt game days. */
export function step(s: GameState, dt: number): void {
  updateMarket(s, dt);
  advanceJobs(s, dt);
  const flows = computeFlows(s, dt);
  applyFlows(s, flows, dt);
  updateFields(s, flows, dt);
  updateWear(s, flows, dt);
  const prevDay = Math.floor(s.day);
  s.day += dt;
  if (Math.floor(s.day) > prevDay) {
    recordHistory(s);
    checkObjectives(s);
  }
}

// ---------- market ----------

function updateMarket(s: GameState, dt: number): void {
  const m = s.market;
  if (rand(s) < MARKET.regimeChancePerDay * dt) {
    const old = m.target;
    m.target = randRange(s, MARKET.minTarget, MARKET.maxTarget);
    if (m.target > old + 8) addLog(s, `Supply squeeze: traders see crude heading toward $${Math.round(m.target)}.`, 'good');
    else if (m.target < old - 8) addLog(s, `Glut fears: crude outlook slides toward $${Math.round(m.target)}.`, 'bad');
  }
  m.base += (m.target - m.base) * (1 - Math.exp(-dt / MARKET.baseRelaxDays));
  m.noise += (-m.noise * dt) / MARKET.noiseRelaxDays + MARKET.noiseVol * Math.sqrt(dt) * randNormal(s);
  m.price = m.base * Math.exp(m.noise);
  m.impact *= Math.exp(-dt / MARKET.impactDecayDays);
}

// ---------- jobs ----------

function advanceJobs(s: GameState, dt: number): void {
  for (const w of s.wells) {
    if (!w.job) continue;
    w.job.daysLeft -= dt;
    if (w.job.daysLeft > 0) continue;
    const job = w.job;
    w.job = null;
    switch (job.kind) {
      case 'drill':
        addLog(s, `${w.name} is drilled and on production.`, 'good');
        break;
      case 'lift':
        w.lift = job.lift!;
        w.condition = 1;
        addLog(s, `${w.name}: ${LIFTS[w.lift].name} installed.`, 'good');
        break;
      case 'frac': {
        const f = fieldById(s, w.fieldId);
        w.stim += ECON.fracBoost * Math.pow(ECON.fracBoostDecayPerFrac, w.fracCount);
        w.fracCount++;
        f.rfFrac = Math.min(0.03, f.rfFrac + ECON.fracRfBonus);
        addLog(s, `${w.name}: frac job complete — productivity up.`, 'good');
        break;
      }
      case 'convert':
        w.status = 'injector';
        w.condition = 1;
        addLog(s, `${w.name} converted to water injector.`, 'good');
        break;
      case 'repair':
        w.status = 'active';
        w.condition = 1;
        addLog(s, `${w.name} repaired and back online.`, 'good');
        break;
    }
  }

  for (const f of s.fields) {
    if (!f.devJob) continue;
    f.devJob.daysLeft -= dt;
    if (f.devJob.daysLeft > 0) continue;
    f.devJob = null;
    f.developed = true;
    const well = makeWell(s, s.nextId++, f, 0, `${f.name.split(' ')[0]}-1`);
    s.wells.push(well);
    addLog(s, `${f.name} is tied back to the hub. Discovery well on stream.`, 'good');
  }

  const ex = s.exploration;
  for (const sv of ex.surveys) {
    sv.daysLeft -= dt;
    if (sv.daysLeft > 0) continue;
    ex.blocks[sv.block] = Math.max(ex.blocks[sv.block], sv.kind);
    const leads = blockCells(s, sv.block).filter((c) => c.lead && (sv.kind === 3 || c.lead.detect2d)).length;
    addLog(s, `${sv.kind}D seismic processed: ${leads} lead${leads === 1 ? '' : 's'} mapped.`, leads ? 'good' : 'info');
  }
  ex.surveys = ex.surveys.filter((sv) => sv.daysLeft > 0);

  if (ex.wildcat) {
    ex.wildcat.daysLeft -= dt;
    if (ex.wildcat.daysLeft <= 0) resolveWildcat(s);
  }
}

export function blockCells(s: GameState, block: number) {
  const ex = s.exploration;
  const bw = ex.w / EXPLORATION.block;
  const bx = (block % bw) * EXPLORATION.block;
  const by = Math.floor(block / bw) * EXPLORATION.block;
  const out = [];
  for (let y = by; y < by + EXPLORATION.block; y++)
    for (let x = bx; x < bx + EXPLORATION.block; x++) out.push(ex.cells[y * ex.w + x]);
  return out;
}

function resolveWildcat(s: GameState): void {
  const ex = s.exploration;
  const wc = ex.wildcat!;
  ex.wildcat = null;
  const cell = ex.cells[wc.y * ex.w + wc.x];
  s.stats.wildcats++;
  if (cell.lead && cell.lead.success) {
    const used = new Set(s.fields.map((f) => f.name));
    const name = FIELD_NAMES.find((n) => !used.has(n)) ?? `Field ${s.nextId}`;
    const field = makeFieldFromLead(s, s.nextId++, name, wc.x, wc.y, cell.lead, -1);
    s.fields.push(field);
    cell.drilled = 'discovery';
    cell.fieldId = field.id;
    s.stats.discoveries++;
    const est = reserveEstimate(field);
    if (est.p50 > 1_500_000) {
      addLog(s, `GUSHER! ${name} discovered — P50 ${fmtBbl(est.p50)} recoverable!`, 'jackpot');
    } else {
      addLog(s, `Discovery! ${name}: P50 ${fmtBbl(est.p50)} recoverable.`, 'good');
    }
  } else {
    cell.drilled = 'dry';
    addLog(s, `Dry hole at ${wc.x},${wc.y}. The rig moves on.`, 'bad');
  }
}

// ---------- production ----------

function ratio(rem: number, need: number): number {
  return need > 1e-9 ? rem / need : Infinity;
}

export function computeFlows(s: GameState, dt: number): Flows {
  const out = emptyFlows();
  const sepCap = cap(s, 'separator');
  const injCap = injectionCapacity(s);
  const swdCap = cap(s, 'swd');
  const wtCap = cap(s, 'waterTrucks');
  const waterCap = injCap + swdCap + wtCap;
  const storageCap = cap(s, 'storage');
  const exportCap = exportCapacity(s);
  const price = salePrice(s);
  const selling = isSelling(s);
  const oilRoom = Math.max(0, storageCap - s.storage + (selling ? exportCap * dt : 0)) / dt;

  const pots: { w: Well; fl: WellFlow; gor: number }[] = [];
  for (const w of s.wells) {
    if (!isProducing(w)) continue;
    const f = fieldById(s, w.fieldId);
    const reservoir = reservoirLiquid(f, w);
    const liftCap = liftCapacity(f, w);
    const liquid = Math.min(reservoir, liftCap);
    const wc = waterCut(f, w);
    if (reservoir > liftCap * 1.02) out.liftLimitedWells++;
    pots.push({ w, gor: f.gor, fl: { reservoir, liftCap, wc, liquid, oil: liquid * (1 - wc), water: liquid * wc, gas: 0, inj: 0 } });
    out.liquidPotential += liquid;
  }

  // Choke wells to fit the plant. SCADA chokes the wettest wells first;
  // otherwise every well is choked by the same factor.
  let bottleneck: Bottleneck = 'none';
  const limit = (sep: number, water: number, oil: number): number => {
    const m = Math.max(0, Math.min(1, sep, water, oil));
    if (m < 1 && bottleneck === 'none') bottleneck = m === sep ? 'separator' : m === water ? 'water' : 'storage';
    return m;
  };
  if (s.techs.scada) {
    pots.sort((a, b) => a.fl.wc - b.fl.wc);
    let remSep = sepCap, remWater = waterCap, remOil = oilRoom;
    for (const p of pots) {
      const k = limit(ratio(remSep, p.fl.liquid), ratio(remWater, p.fl.water), ratio(remOil, p.fl.oil));
      p.fl.liquid *= k; p.fl.oil *= k; p.fl.water *= k;
      remSep -= p.fl.liquid; remWater -= p.fl.water; remOil -= p.fl.oil;
    }
  } else {
    let L = 0, W = 0, O = 0;
    for (const p of pots) { L += p.fl.liquid; W += p.fl.water; O += p.fl.oil; }
    const k = limit(ratio(sepCap, L), ratio(waterCap, W), ratio(oilRoom, O));
    for (const p of pots) { p.fl.liquid *= k; p.fl.oil *= k; p.fl.water *= k; }
  }
  out.bottleneck = bottleneck;

  let powerCost = 0;
  for (const p of pots) {
    p.fl.gas = (p.fl.oil * p.gor) / 1000;
    out.liquid += p.fl.liquid; out.oil += p.fl.oil; out.water += p.fl.water; out.gas += p.fl.gas;
    powerCost += p.fl.liquid * LIFTS[p.w.lift].powerPerBbl;
    out.wells[p.w.id] = p.fl;
  }
  out.choke = out.liquidPotential > 0 ? out.liquid / out.liquidPotential : 1;

  // Injection is split evenly between online injectors.
  const injectors = s.wells.filter((w) => w.status === 'injector' && !w.job);
  for (const w of injectors) {
    out.wells[w.id] = { reservoir: 0, liftCap: 0, wc: 0, liquid: 0, oil: 0, water: 0, gas: 0, inj: injCap / injectors.length };
  }

  // Water routing: re-injection first, then disposal well, then trucks.
  const injFromProduced = Math.min(out.water, injCap);
  let rem = out.water - injFromProduced;
  const swd = Math.min(rem, swdCap);
  rem -= swd;
  const trucked = Math.min(rem, wtCap);
  const sourceWater = injCap - injFromProduced;

  // Sales: pipeline first (cheaper), then trucks.
  const soldVol = selling ? Math.min(exportCap * dt, s.storage + out.oil * dt) : 0;
  const pipeVol = Math.min(soldVol, cap(s, 'pipeline') * dt);
  const sold = soldVol / dt;
  const soldPipe = pipeVol / dt;

  const gasSold = Math.min(out.gas, cap(s, 'compressor'));
  const gasFlared = out.gas - gasSold;

  let wellOpex = 0;
  for (const w of s.wells) {
    if (w.status === 'injector') wellOpex += w.job ? 0 : ECON.injectorOpexDay;
    else if (w.status === 'shutin' || w.status === 'failed') wellOpex += ECON.shutinOpexDay;
    else if (!w.job) wellOpex += LIFTS[w.lift].opexDay;
  }
  let facOpex = ECON.hubBaseOpexDay;
  for (const id of Object.keys(FACILITIES) as FacilityId[]) facOpex += facilityOpex(id, s.facilities[id]);

  const costs: Record<string, number> = {
    'Well opex': wellOpex,
    'Lift power': powerCost,
    Facilities: facOpex,
    'Water handling':
      injFromProduced * ECON.injectionPerBbl +
      sourceWater * (ECON.injectionPerBbl + ECON.sourceWaterPerBbl) +
      swd * ECON.swdPerBbl +
      trucked * ECON.waterTruckPerBbl,
    Transport: soldPipe * ECON.pipePerBbl + (sold - soldPipe) * ECON.truckPerBbl,
    Flaring: gasFlared * ECON.flarePerMcf,
  };
  if (s.techs.maintCrew) costs['Crew wages'] = ECON.maintWageDay;

  out.sepCap = sepCap; out.waterCap = waterCap; out.storageCap = storageCap;
  out.exportCap = exportCap; out.injCap = injCap; out.injected = injCap;
  out.injFromProduced = injFromProduced; out.swd = swd; out.waterTrucked = trucked;
  out.sold = sold; out.soldPipe = soldPipe; out.gasSold = gasSold; out.gasFlared = gasFlared;
  out.salePrice = price;
  out.revenue = sold * price + gasSold * ECON.gasPricePerMcf;
  out.costs = costs;
  out.costTotal = Object.values(costs).reduce((a, b) => a + b, 0);
  out.profit = out.revenue - out.costTotal;
  return out;
}

function applyFlows(s: GameState, fl: Flows, dt: number): void {
  const soldVol = fl.sold * dt;
  s.storage = Math.min(fl.storageCap, Math.max(0, s.storage + fl.oil * dt - soldVol));
  s.cash += fl.profit * dt;
  for (const w of s.wells) {
    const wf = fl.wells[w.id];
    if (!wf) continue;
    w.np += wf.oil * dt;
    w.wp += wf.water * dt;
    fieldById(s, w.fieldId).np += wf.oil * dt;
  }
  s.market.impact = Math.min(MARKET.maxImpact, s.market.impact + soldVol / marketDepth(s));
  s.stats.oilProduced += fl.oil * dt;
  s.stats.oilSold += soldVol;
  s.stats.revenue += fl.revenue * dt;
  s.flows = fl;
}

function updateFields(s: GameState, fl: Flows, dt: number): void {
  const relax = 1 - Math.exp(-dt / RESERVOIR.floodRelaxDays);
  const mature = 1 - Math.exp(-dt / RESERVOIR.floodMatureDays);
  for (const f of s.fields) {
    if (!f.developed) continue;
    let liquid = 0, inj = 0;
    for (const w of s.wells) {
      if (w.fieldId !== f.id) continue;
      const wf = fl.wells[w.id];
      if (!wf) continue;
      liquid += wf.liquid;
      inj += wf.inj;
    }
    const target = inj <= 0 ? 0 : liquid < 1 ? 1 : Math.min(1, inj / liquid);
    f.flood += (target - f.flood) * relax;
    // Swept oil stays swept: maturity only ratchets up.
    if (f.flood > f.floodMaturity) f.floodMaturity += (f.flood - f.floodMaturity) * mature;
  }
}

function updateWear(s: GameState, fl: Flows, dt: number): void {
  const stimDecay = Math.exp(-dt / ECON.fracDecayDays);
  for (const w of s.wells) {
    w.stim *= stimDecay;
    const wf = fl.wells[w.id];
    if (!isProducing(w) || !wf) continue;
    const nominal = LIFTS[w.lift].capacity;
    const util = Math.min(1, wf.liquid / nominal);
    w.condition = Math.max(0, w.condition - LIFTS[w.lift].wearPerDay * (0.3 + 0.7 * util) * dt);
    if (w.condition < ECON.failThreshold && rand(s) < (ECON.failThreshold - w.condition) * ECON.failRate * dt) {
      w.status = 'failed';
      addLog(s, `${LIFTS[w.lift].name} failure on ${w.name} — well is down. Repair ${fmtMoney(repairCost(w))}.`, 'bad');
    }
  }

  if (!s.techs.maintCrew) return;
  for (const w of s.wells) {
    if (w.job) continue;
    if (w.status === 'failed') {
      const c = repairCost(w);
      if (s.cash >= c) {
        s.cash -= c;
        w.job = { kind: 'repair', daysLeft: ECON.repairDays, total: ECON.repairDays };
        addLog(s, `Crew dispatched to repair ${w.name} (${fmtMoney(c)}).`);
      }
    } else if ((w.status === 'active' || w.status === 'shutin') && w.condition < ECON.maintThreshold) {
      const c = serviceCost(w);
      if (s.cash >= c) {
        s.cash -= c;
        w.condition = 1;
      }
    }
  }
}

function recordHistory(s: GameState): void {
  const h = s.history;
  const fl = s.flows;
  h.day.push(Math.floor(s.day));
  h.price.push(s.market.price);
  h.oil.push(fl.oil);
  h.water.push(fl.water);
  h.cash.push(s.cash);
  h.profit.push(fl.profit);
  if (h.day.length > TIME.historyDays) {
    for (const k of Object.keys(h) as (keyof typeof h)[]) h[k].shift();
  }
}
