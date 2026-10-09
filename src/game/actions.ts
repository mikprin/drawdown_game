import { DECK, ECON, EXPLORATION, FACILITIES, LIFTS, MODULES, OFFSHORE, TECHS } from './balance';
import { isDrillable, mapCfg, mapOf, undrillable } from './explore';
import { addLog } from './log';
import { generateShelf, makeWell, newWeather } from './newGame';
import { newTanker } from './offshore';
import {
  decomCost, deckArea, deckUsed, installCost, moduleNextArea, newModules, platformById, platformLive,
  platformOfField, rigUser, wildcatShelfCost,
} from './platform';
import {
  facilityNextCost, fieldById, fieldWells, fracCost, freeSlot, isOffshoreWell, liftCost, repairCost,
  serviceCost, wellById,
} from './reservoir';
import type { MsgKey } from '../i18n/en';
import { msg, type Msg, type MsgParams } from './msg';
import type { FacilityId, GameState, LiftType, MapId, ModuleId, SellMode, TechId, Well } from './types';

/**
 * Every player action validates first and only mutates when `dry` is false.
 * UI calls with dry=true to grey out buttons and show the reason.
 */
export type Result =
  | { ok: true; cost: number }
  /** `cost` is set when the only problem is cash, so buttons can still show the price. */
  | { ok: false; reason: Msg; cost?: number };

const fail = (key: MsgKey, params?: MsgParams): Result => ({ ok: false, reason: msg(key, params) });

const techName = (id: TechId) => msg(`tech.${id}.name`);

function charge(s: GameState, cost: number, dry: boolean, apply: () => void): Result {
  if (s.cash < cost) return { ok: false, reason: msg('reason.needCash', { cost }), cost };
  if (!dry) {
    s.cash -= cost;
    apply();
  }
  return { ok: true, cost };
}


// ---------- hub ----------

export function buyFacility(s: GameState, id: FacilityId, dry = false): Result {
  const def = FACILITIES[id];
  if (def.requiresTech && !s.techs[def.requiresTech]) return fail('reason.requires', { what: techName(def.requiresTech) });
  const cost = facilityNextCost(id, s.facilities[id]);
  if (cost === null) return fail('reason.maxed');
  return charge(s, cost, dry, () => {
    s.facilities[id]++;
    addLog(s, msg('log.facilityUp', { facility: msg(`fac.${id}.name`) }));
  });
}

export function techLockReason(s: GameState, id: TechId): Msg | null {
  const def = TECHS[id];
  if (s.techs[id]) return msg('reason.owned');
  const missing = (def.requires ?? []).filter((r) => !s.techs[r]);
  if (missing.length) return msg('reason.requires', { what: missing.map(techName) });
  if (def.comingSoon) return msg('reason.comingSoon');
  return null;
}

export function buyTech(s: GameState, id: TechId, dry = false): Result {
  const lock = techLockReason(s, id);
  if (lock) return { ok: false, reason: lock };
  const def = TECHS[id];
  return charge(s, def.cost, dry, () => {
    s.techs[id] = true;
    if (id === 'wellPad') {
      const home = s.fields[0];
      home.slots = Math.max(home.slots, ECON.padSlotsWithPad);
    }
    if (id === 'offshore' && !s.shelf) {
      s.shelf = generateShelf(s);
      s.weather = newWeather();
    }
    addLog(s, msg('log.unlocked', { tech: techName(id) }), 'good');
  });
}

export function setSellMode(s: GameState, mode: SellMode): void {
  s.market.sellMode = mode;
}

export function setSellWhenFull(s: GameState, on: boolean): void {
  s.market.sellWhenFull = on;
}

export function setThreshold(s: GameState, v: number): void {
  s.market.threshold = Math.max(10, Math.min(200, Math.round(v)));
}

// ---------- wells ----------

/** Offshore well work that needs the platform rig: refuse while another job holds it. */
function rigCheck(s: GameState, w: Well): Result | null {
  if (!isOffshoreWell(s, w)) return null;
  const user = rigUser(s, w.fieldId);
  return user && user.id !== w.id ? fail('reason.rigOn', { well: user.name }) : null;
}

export function drillWell(s: GameState, fieldId: number, dry = false): Result {
  const f = fieldById(s, fieldId);
  if (!f.developed) return fail(f.offshore ? 'reason.platformNotReady' : 'reason.notDeveloped');
  if (f.offshore) {
    const p = platformOfField(s, f.id);
    if (!p || !platformLive(s, p)) return fail('reason.platformNotReady');
    const user = rigUser(s, f.id);
    if (user) return fail('reason.rigOn', { well: user.name });
  }
  const slot = freeSlot(s, f);
  if (slot === null) return fail(f.offshore ? 'reason.wellbayFull' : s.techs.wellPad ? 'reason.padFull' : 'reason.needPad');
  const days = drillDays(s, fieldId);
  return charge(s, drillCost(s, fieldId), dry, () => {
    const n = fieldWells(s, f.id).length + 1;
    const prefix = f.name.split(' ')[0];
    let name = `${prefix}-${n}`;
    for (let i = n; s.wells.some((w) => w.name === name); i++) name = `${prefix}-${i + 1}`;
    const w = makeWell(s, s.nextId++, f, slot, name);
    w.job = { kind: 'drill', daysLeft: days, total: days };
    s.wells.push(w);
    s.stats.wellsDrilled++;
    addLog(s, msg('log.spud', { well: name }));
  });
}

export function drillCost(s: GameState, fieldId: number): number {
  const f = fieldById(s, fieldId);
  return Math.round((f.offshore ? OFFSHORE.drillCost : ECON.drillCost) * f.costMult);
}

export function drillDays(s: GameState, fieldId: number): number {
  return fieldById(s, fieldId).offshore ? OFFSHORE.drillDays : ECON.drillDays;
}

export function expandPadCost(s: GameState, fieldId: number): number | null {
  const f = fieldById(s, fieldId);
  const idx = (f.slots - ECON.padSlotsWithPad) / 2;
  if (f.slots < ECON.padSlotsWithPad || f.slots >= ECON.padMaxSlots) return null;
  return ECON.padExpandCost[idx] ?? null;
}

export function expandPad(s: GameState, fieldId: number, dry = false): Result {
  const f = fieldById(s, fieldId);
  if (f.offshore) {
    const p = platformOfField(s, fieldId);
    return p ? buyModule(s, p.id, 'wellbay', dry) : fail('reason.platformNotReady');
  }
  if (!s.techs.wellPad) return fail('reason.needPad');
  if (!f.developed) return fail('reason.notDeveloped');
  const cost = expandPadCost(s, fieldId);
  if (cost === null) return fail('reason.padMax');
  return charge(s, cost, dry, () => {
    f.slots += 2;
    addLog(s, msg('log.padExpanded', { field: f.name, slots: f.slots }));
  });
}

export function liftLockReason(s: GameState, lift: LiftType, w?: Well): Msg | null {
  const def = LIFTS[lift];
  if (def.requiresTech && !s.techs[def.requiresTech]) return msg('reason.requires', { what: techName(def.requiresTech) });
  if (w && isOffshoreWell(s, w)) {
    if (lift === 'rodpump') return msg('reason.noRodOffshore');
    // Gas lift at sea draws on the platform's gas compression module.
    const p = platformOfField(s, w.fieldId);
    if (lift === 'gaslift' && (!p || p.modules.gasInj < 1)) return msg('reason.requires', { what: msg('mod.gasInj.name') });
    return null;
  }
  if (def.requiresFacility && s.facilities[def.requiresFacility] < 1)
    return msg('reason.requires', { what: msg(`fac.${def.requiresFacility}.name`) });
  return null;
}

export function setLift(s: GameState, wellId: number, lift: LiftType, dry = false): Result {
  const w = wellById(s, wellId);
  if (!w) return fail('reason.noWell');
  if (w.job) return fail('reason.busy');
  if (w.status === 'injector') return fail('reason.isInjector');
  if (w.status === 'failed') return fail('reason.repairFirst');
  if (w.lift === lift) return fail('reason.alreadyInstalled');
  const lock = liftLockReason(s, lift, w);
  if (lock) return { ok: false, reason: lock };
  const def = LIFTS[lift];
  if (def.installDays > 0) {
    const busy = rigCheck(s, w);
    if (busy) return busy;
  }
  return charge(s, liftCost(s, w, lift), dry, () => {
    w.job = { kind: 'lift', daysLeft: def.installDays, total: def.installDays, lift };
    if (def.installDays === 0) {
      w.lift = lift;
      w.job = null;
    }
  });
}

export function fracWell(s: GameState, wellId: number, dry = false): Result {
  const w = wellById(s, wellId);
  if (!w) return fail('reason.noWell');
  if (w.job) return fail('reason.busy');
  if (w.status !== 'active') return fail('reason.mustProduce');
  if (w.fracCount >= ECON.fracMax) return fail('reason.noFracs');
  return charge(s, fracCost(s, w), dry, () => {
    w.job = { kind: 'frac', daysLeft: ECON.fracDays, total: ECON.fracDays };
  });
}

export function convertToInjector(s: GameState, wellId: number, dry = false): Result {
  if (!s.techs.waterflood) return fail('reason.requires', { what: techName('waterflood') });
  const w = wellById(s, wellId);
  if (!w) return fail('reason.noWell');
  if (w.job) return fail('reason.busy');
  if (w.status === 'injector') return fail('reason.alreadyInjector');
  if (w.status === 'failed') return fail('reason.repairFirst');
  const busy = rigCheck(s, w);
  if (busy) return busy;
  return charge(s, convertCost(s, w), dry, () => {
    w.status = 'active';
    w.job = { kind: 'convert', daysLeft: ECON.convertDays, total: ECON.convertDays };
  });
}

export function toggleShutIn(s: GameState, wellId: number, dry = false): Result {
  const w = wellById(s, wellId);
  if (!w) return fail('reason.noWell');
  if (w.job) return fail('reason.busy');
  if (w.status !== 'active' && w.status !== 'shutin') return fail('reason.notPossible');
  if (!dry) {
    w.status = w.status === 'active' ? 'shutin' : 'active';
    addLog(s, msg(w.status === 'shutin' ? 'log.shutIn' : 'log.reopened', { well: w.name }));
  }
  return { ok: true, cost: 0 };
}

export function plugWell(s: GameState, wellId: number, dry = false): Result {
  const w = wellById(s, wellId);
  if (!w) return fail('reason.noWell');
  if (w.job) return fail('reason.busy');
  return charge(s, isOffshoreWell(s, w) ? OFFSHORE.plugCost : ECON.plugCost, dry, () => {
    s.wells = s.wells.filter((x) => x.id !== w.id);
    addLog(s, msg('log.plugged', { well: w.name }));
  });
}

export function serviceWell(s: GameState, wellId: number, dry = false): Result {
  const w = wellById(s, wellId);
  if (!w) return fail('reason.noWell');
  if (w.job) return fail('reason.busy');
  if (w.status === 'failed') return fail('reason.needsRepair');
  if (w.condition > 0.97) return fail('reason.goodShape');
  return charge(s, serviceCost(s, w), dry, () => {
    w.condition = 1;
  });
}

export function repairWell(s: GameState, wellId: number, dry = false): Result {
  const w = wellById(s, wellId);
  if (!w) return fail('reason.noWell');
  if (w.status !== 'failed') return fail('reason.notFailed');
  if (w.job) return fail('reason.repairUnderway');
  const busy = rigCheck(s, w);
  if (busy) return busy;
  return charge(s, repairCost(s, w), dry, () => {
    w.job = { kind: 'repair', daysLeft: ECON.repairDays, total: ECON.repairDays };
  });
}

// ---------- exploration ----------

function mapLock(s: GameState, map: MapId): Result | null {
  const tech: TechId = map === 'shelf' ? 'offshore' : 'exploration';
  if (!s.techs[tech]) return fail('reason.requires', { what: techName(tech) });
  return null;
}

export function surveyCost(kind: 2 | 3, map: MapId = 'land'): number {
  const cfg = mapCfg(map);
  return kind === 2 ? cfg.survey2dCost : cfg.survey3dCost;
}

export function surveyDays(kind: 2 | 3, map: MapId = 'land'): number {
  const cfg = mapCfg(map);
  return kind === 2 ? cfg.survey2dDays : cfg.survey3dDays;
}

export function surveyBlock(s: GameState, block: number, kind: 2 | 3, dry = false, map: MapId = 'land'): Result {
  const lock = mapLock(s, map);
  if (lock) return lock;
  if (kind === 3 && !s.techs.seismic3d) return fail('reason.requires', { what: techName('seismic3d') });
  const ex = mapOf(s, map);
  if (block < 0 || block >= ex.blocks.length) return fail('reason.outside');
  if (ex.blocks[block] >= kind) return fail('reason.surveyed');
  if (ex.surveys.some((sv) => sv.block === block)) return fail('reason.surveyUnderway');
  const days = surveyDays(kind, map);
  return charge(s, surveyCost(kind, map), dry, () => {
    ex.surveys.push({ block, kind, daysLeft: days, total: days });
    addLog(s, msg(map === 'shelf' ? 'log.shelfCrew' : 'log.crewDeployed', { kind }));
  });
}

export function wildcatCost(s: GameState, x: number, y: number, map: MapId = 'land'): number {
  if (map === 'shelf') return wildcatShelfCost(s, x, y);
  const c = s.exploration.cells[y * s.exploration.w + x];
  return Math.round(EXPLORATION.wildcatCost * EXPLORATION.terrainCostMult[c.terrain] * (c.lead?.costMult ?? 1.2));
}

export function drillWildcat(s: GameState, x: number, y: number, dry = false, map: MapId = 'land'): Result {
  const lock = mapLock(s, map);
  if (lock) return lock;
  const ex = mapOf(s, map);
  if (x < 0 || y < 0 || x >= ex.w || y >= ex.h) return fail('reason.outside');
  if (ex.wildcat) return fail(map === 'shelf' ? 'reason.jackupBusy' : 'reason.rigBusy');
  const c = ex.cells[y * ex.w + x];
  if (c.terrain === 3) return fail('reason.lake');
  if (c.terrain === 4) return fail('reason.coast');
  if (c.terrain === 8) return fail('reason.tooDeep');
  if (c.drilled !== 'none') return fail('reason.drilled');
  if (!isDrillable(ex, x, y) || undrillable(c.terrain)) return fail(map === 'shelf' ? 'reason.nearBase' : 'reason.nearHub');
  const days = mapCfg(map).wildcatDays;
  return charge(s, wildcatCost(s, x, y, map), dry, () => {
    ex.wildcat = { x, y, daysLeft: days, total: days };
    addLog(s, msg(map === 'shelf' ? 'log.shelfWildcat' : 'log.wildcat', { x, y }));
  });
}

export function developCost(s: GameState, fieldId: number): number {
  const f = fieldById(s, fieldId);
  const ex = s.exploration;
  const dist = Math.hypot(f.cellX - ex.hubX, f.cellY - ex.hubY);
  const developed = s.fields.filter((x) => (x.developed || x.devJob) && !x.offshore).length;
  return Math.round(
    (EXPLORATION.developBase + EXPLORATION.developPerCell * dist) * Math.pow(EXPLORATION.developGrowth, developed - 1),
  );
}

export function developField(s: GameState, fieldId: number, dry = false): Result {
  const f = fieldById(s, fieldId);
  if (f.offshore) return installPlatform(s, fieldId, dry);
  if (f.developed) return fail('reason.developed');
  if (f.devJob) return fail('reason.constructing');
  if (!s.techs.wellPad) return fail('reason.needPad');
  const active = s.fields.filter((x) => (x.developed || x.devJob) && !x.offshore);
  if (active.length >= EXPLORATION.maxFields) return fail('reason.hubFields', { n: EXPLORATION.maxFields });
  return charge(s, developCost(s, fieldId), dry, () => {
    const used = new Set(active.map((x) => x.padIndex));
    let pad = 1;
    while (used.has(pad)) pad++;
    f.padIndex = pad;
    f.devJob = { daysLeft: EXPLORATION.developDays, total: EXPLORATION.developDays };
    addLog(s, msg('log.developing', { field: f.name }));
  });
}

export function convertToProducer(s: GameState, wellId: number, dry = false): Result {
  const w = wellById(s, wellId);
  if (!w) return fail('reason.noWell');
  if (w.job) return fail('reason.busy');
  if (w.status !== 'injector') return fail('reason.notInjector');
  const busy = rigCheck(s, w);
  if (busy) return busy;
  return charge(s, convertCost(s, w), dry, () => {
    w.status = 'active';
    w.job = { kind: 'lift', daysLeft: ECON.convertDays, total: ECON.convertDays, lift: w.lift };
    addLog(s, msg('log.backOnProd', { well: w.name }));
  });
}

export function convertCost(s: GameState, w: Well): number {
  return isOffshoreWell(s, w) ? OFFSHORE.convertCost : ECON.convertCost;
}

// ---------- platforms ----------

export function installPlatform(s: GameState, fieldId: number, dry = false): Result {
  if (!s.techs.offshore) return fail('reason.requires', { what: techName('offshore') });
  const f = fieldById(s, fieldId);
  if (!f.offshore) return fail('reason.notPossible');
  if (f.abandoned) return fail('reason.abandoned');
  if (f.developed) return fail('reason.developed');
  if (f.devJob) return fail('reason.constructing');
  if (s.platforms.length >= OFFSHORE.maxPlatforms) return fail('reason.maxPlatforms', { n: OFFSHORE.maxPlatforms });
  return charge(s, installCost(s, f), dry, () => {
    s.platforms.push({
      id: s.nextId++, fieldId: f.id, deck: 0, modules: newModules(), storage: 0, tankers: [], revenueEma: 0, decom: null,
    });
    f.slots = MODULES.wellbay.levels[0].value;
    f.devJob = { daysLeft: OFFSHORE.installDays, total: OFFSHORE.installDays };
    addLog(s, msg('log.platformOrdered', { field: f.name }));
  });
}

function livePlatform(s: GameState, id: number): Result | null {
  const p = platformById(s, id);
  if (!p) return fail('reason.noPlatform');
  if (p.decom) return fail('reason.decommissioning');
  return null;
}

export function moduleLockReason(s: GameState, platformId: number, id: ModuleId): Msg | null {
  const p = platformById(s, platformId);
  if (!p) return msg('reason.noPlatform');
  const req = MODULES[id].requiresTech;
  if (req && !s.techs[req]) return msg('reason.requires', { what: techName(req) });
  const extra = moduleNextArea(p, id);
  if (extra === null) return msg('reason.maxed');
  if (deckUsed(p) + extra > deckArea(p)) return msg('reason.deckFull', { need: extra, free: deckArea(p) - deckUsed(p) });
  return null;
}

export function buyModule(s: GameState, platformId: number, id: ModuleId, dry = false): Result {
  const bad = livePlatform(s, platformId);
  if (bad) return bad;
  const p = platformById(s, platformId)!;
  const lock = moduleLockReason(s, platformId, id);
  if (lock) return { ok: false, reason: lock };
  const next = MODULES[id].levels[p.modules[id] + 1];
  return charge(s, next.cost, dry, () => {
    p.modules[id]++;
    if (id === 'wellbay') fieldById(s, p.fieldId).slots = next.value;
    addLog(s, msg('log.moduleUp', { module: msg(`mod.${id}.name`), field: fieldById(s, p.fieldId).name }));
  });
}

export function expandDeck(s: GameState, platformId: number, dry = false): Result {
  const bad = livePlatform(s, platformId);
  if (bad) return bad;
  const p = platformById(s, platformId)!;
  const next = DECK[p.deck + 1];
  if (!next) return fail('reason.maxed');
  return charge(s, next.cost, dry, () => {
    p.deck++;
    addLog(s, msg('log.deckUp', { field: fieldById(s, p.fieldId).name, area: next.area }));
  });
}

export function charterTanker(s: GameState, platformId: number, dry = false): Result {
  const bad = livePlatform(s, platformId);
  if (bad) return bad;
  const p = platformById(s, platformId)!;
  if (!platformLive(s, p)) return fail('reason.platformNotReady');
  if (p.tankers.length >= OFFSHORE.tankerMax) return fail('reason.maxed');
  return charge(s, OFFSHORE.tankerMobilise, dry, () => {
    p.tankers.push(newTanker(s, p));
    addLog(s, msg('log.tankerChartered', { field: fieldById(s, p.fieldId).name, n: p.tankers.length }));
  });
}

/** Hand back an empty tanker that is not alongside. The last one stays. */
export function releaseTanker(s: GameState, platformId: number, dry = false): Result {
  const bad = livePlatform(s, platformId);
  if (bad) return bad;
  const p = platformById(s, platformId)!;
  if (p.tankers.length <= 1) return fail('reason.lastTanker');
  const idx = p.tankers.findIndex((t) => t.cargo === 0 && t.state !== 'moored');
  if (idx < 0) return fail('reason.tankersBusy');
  if (!dry) {
    p.tankers.splice(idx, 1);
    addLog(s, msg('log.tankerReleased', { field: fieldById(s, p.fieldId).name, n: p.tankers.length }));
  }
  return { ok: true, cost: 0 };
}

export function decommission(s: GameState, platformId: number, dry = false): Result {
  const bad = livePlatform(s, platformId);
  if (bad) return bad;
  const p = platformById(s, platformId)!;
  const f = fieldById(s, p.fieldId);
  if (f.devJob) return fail('reason.constructing');
  return charge(s, decomCost(s, p), dry, () => {
    // Plug every well; whatever is in the tanks goes out on one last lifting at today's price.
    s.wells = s.wells.filter((w) => w.fieldId !== f.id);
    if (p.storage > 0) {
      const moored = p.tankers.find((t) => t.state === 'moored' || t.state === 'queued');
      if (moored) moored.cargo += p.storage;
      p.storage = 0;
    }
    for (const t of p.tankers) {
      if (t.cargo > 0 && (t.state === 'moored' || t.state === 'queued')) {
        t.state = 'outbound';
        t.daysLeft = OFFSHORE.legBase;
      }
    }
    p.tankers = p.tankers.filter((t) => t.cargo > 0);
    p.decom = { daysLeft: OFFSHORE.decomDays, total: OFFSHORE.decomDays };
    f.developed = false;
    f.abandoned = true;
    addLog(s, msg('log.decomStart', { field: f.name }), 'bad');
  });
}
