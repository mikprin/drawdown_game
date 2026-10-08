import { ECON, EXPLORATION, FACILITIES, LIFTS, TECHS } from './balance';
import { makeWell } from './newGame';
import {
  facilityNextCost, fieldById, fieldWells, fracCost, freeSlot, repairCost, serviceCost, wellById,
} from './reservoir';
import { addLog } from './sim';
import type { MsgKey } from '../i18n/en';
import { msg, type Msg, type MsgParams } from './msg';
import type { FacilityId, GameState, LiftType, SellMode, TechId } from './types';

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
    addLog(s, msg('log.unlocked', { tech: techName(id) }), 'good');
  });
}

export function setSellMode(s: GameState, mode: SellMode): void {
  s.market.sellMode = mode;
}

export function setThreshold(s: GameState, v: number): void {
  s.market.threshold = Math.max(10, Math.min(200, Math.round(v)));
}

// ---------- wells ----------

export function drillWell(s: GameState, fieldId: number, dry = false): Result {
  const f = fieldById(s, fieldId);
  if (!f.developed) return fail('reason.notDeveloped');
  const slot = freeSlot(s, f);
  if (slot === null) return fail(s.techs.wellPad ? 'reason.padFull' : 'reason.needPad');
  return charge(s, drillCost(s, fieldId), dry, () => {
    const n = fieldWells(s, f.id).length + 1;
    const prefix = f.name.split(' ')[0];
    let name = `${prefix}-${n}`;
    for (let i = n; s.wells.some((w) => w.name === name); i++) name = `${prefix}-${i + 1}`;
    const w = makeWell(s, s.nextId++, f, slot, name);
    w.job = { kind: 'drill', daysLeft: ECON.drillDays, total: ECON.drillDays };
    s.wells.push(w);
    s.stats.wellsDrilled++;
    addLog(s, msg('log.spud', { well: name }));
  });
}

export function drillCost(s: GameState, fieldId: number): number {
  return Math.round(ECON.drillCost * fieldById(s, fieldId).costMult);
}

export function expandPadCost(s: GameState, fieldId: number): number | null {
  const f = fieldById(s, fieldId);
  const idx = (f.slots - ECON.padSlotsWithPad) / 2;
  if (f.slots < ECON.padSlotsWithPad || f.slots >= ECON.padMaxSlots) return null;
  return ECON.padExpandCost[idx] ?? null;
}

export function expandPad(s: GameState, fieldId: number, dry = false): Result {
  if (!s.techs.wellPad) return fail('reason.needPad');
  const f = fieldById(s, fieldId);
  if (!f.developed) return fail('reason.notDeveloped');
  const cost = expandPadCost(s, fieldId);
  if (cost === null) return fail('reason.padMax');
  return charge(s, cost, dry, () => {
    f.slots += 2;
    addLog(s, msg('log.padExpanded', { field: f.name, slots: f.slots }));
  });
}

export function liftLockReason(s: GameState, lift: LiftType): Msg | null {
  const def = LIFTS[lift];
  if (def.requiresTech && !s.techs[def.requiresTech]) return msg('reason.requires', { what: techName(def.requiresTech) });
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
  const lock = liftLockReason(s, lift);
  if (lock) return { ok: false, reason: lock };
  const def = LIFTS[lift];
  return charge(s, def.cost, dry, () => {
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
  return charge(s, fracCost(w), dry, () => {
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
  return charge(s, ECON.convertCost, dry, () => {
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
  return charge(s, ECON.plugCost, dry, () => {
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
  return charge(s, serviceCost(w), dry, () => {
    w.condition = 1;
  });
}

export function repairWell(s: GameState, wellId: number, dry = false): Result {
  const w = wellById(s, wellId);
  if (!w) return fail('reason.noWell');
  if (w.status !== 'failed') return fail('reason.notFailed');
  if (w.job) return fail('reason.repairUnderway');
  return charge(s, repairCost(w), dry, () => {
    w.job = { kind: 'repair', daysLeft: ECON.repairDays, total: ECON.repairDays };
  });
}

// ---------- exploration ----------

export function surveyCost(kind: 2 | 3): number {
  return kind === 2 ? EXPLORATION.survey2dCost : EXPLORATION.survey3dCost;
}

export function surveyBlock(s: GameState, block: number, kind: 2 | 3, dry = false): Result {
  if (!s.techs.exploration) return fail('reason.requires', { what: techName('exploration') });
  if (kind === 3 && !s.techs.seismic3d) return fail('reason.requires', { what: techName('seismic3d') });
  const ex = s.exploration;
  if (block < 0 || block >= ex.blocks.length) return fail('reason.outside');
  if (ex.blocks[block] >= kind) return fail('reason.surveyed');
  if (ex.surveys.some((sv) => sv.block === block)) return fail('reason.surveyUnderway');
  const days = kind === 2 ? EXPLORATION.survey2dDays : EXPLORATION.survey3dDays;
  return charge(s, surveyCost(kind), dry, () => {
    ex.surveys.push({ block, kind, daysLeft: days, total: days });
    addLog(s, msg('log.crewDeployed', { kind }));
  });
}

export function wildcatCost(s: GameState, x: number, y: number): number {
  const c = s.exploration.cells[y * s.exploration.w + x];
  return Math.round(EXPLORATION.wildcatCost * EXPLORATION.terrainCostMult[c.terrain] * (c.lead?.costMult ?? 1.2));
}

export function drillWildcat(s: GameState, x: number, y: number, dry = false): Result {
  if (!s.techs.exploration) return fail('reason.requires', { what: techName('exploration') });
  const ex = s.exploration;
  if (x < 0 || y < 0 || x >= ex.w || y >= ex.h) return fail('reason.outside');
  if (ex.wildcat) return fail('reason.rigBusy');
  const c = ex.cells[y * ex.w + x];
  if (c.terrain === 3) return fail('reason.lake');
  if (c.drilled !== 'none') return fail('reason.drilled');
  if (Math.abs(x - ex.hubX) <= 1 && Math.abs(y - ex.hubY) <= 1) return fail('reason.nearHub');
  return charge(s, wildcatCost(s, x, y), dry, () => {
    ex.wildcat = { x, y, daysLeft: EXPLORATION.wildcatDays, total: EXPLORATION.wildcatDays };
    addLog(s, msg('log.wildcat', { x, y }));
  });
}

export function developCost(s: GameState, fieldId: number): number {
  const f = fieldById(s, fieldId);
  const ex = s.exploration;
  const dist = Math.hypot(f.cellX - ex.hubX, f.cellY - ex.hubY);
  const developed = s.fields.filter((x) => x.developed || x.devJob).length;
  return Math.round(
    (EXPLORATION.developBase + EXPLORATION.developPerCell * dist) * Math.pow(EXPLORATION.developGrowth, developed - 1),
  );
}

export function developField(s: GameState, fieldId: number, dry = false): Result {
  const f = fieldById(s, fieldId);
  if (f.developed) return fail('reason.developed');
  if (f.devJob) return fail('reason.constructing');
  if (!s.techs.wellPad) return fail('reason.needPad');
  const active = s.fields.filter((x) => x.developed || x.devJob);
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
  return charge(s, ECON.convertCost, dry, () => {
    w.status = 'active';
    w.job = { kind: 'lift', daysLeft: ECON.convertDays, total: ECON.convertDays, lift: w.lift };
    addLog(s, msg('log.backOnProd', { well: w.name }));
  });
}
