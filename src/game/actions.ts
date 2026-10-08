import { ECON, EXPLORATION, FACILITIES, LIFTS, TECHS } from './balance';
import { makeWell } from './newGame';
import {
  facilityNextCost, fieldById, fieldWells, fracCost, freeSlot, repairCost, serviceCost, wellById,
} from './reservoir';
import { addLog } from './sim';
import { fmtMoney } from './format';
import type { FacilityId, GameState, LiftType, SellMode, TechId, Well } from './types';

/**
 * Every player action validates first and only mutates when `dry` is false.
 * UI calls with dry=true to grey out buttons and show the reason.
 */
export type Result = { ok: true; cost: number } | { ok: false; reason: string };

const fail = (reason: string): Result => ({ ok: false, reason });

function charge(s: GameState, cost: number, dry: boolean, apply: () => void): Result {
  if (s.cash < cost) return fail(`Need ${fmtMoney(cost)}`);
  if (!dry) {
    s.cash -= cost;
    apply();
  }
  return { ok: true, cost };
}

function getWell(s: GameState, id: number): Well | string {
  const w = wellById(s, id);
  return w ?? 'No such well';
}

// ---------- hub ----------

export function buyFacility(s: GameState, id: FacilityId, dry = false): Result {
  const def = FACILITIES[id];
  if (def.requiresTech && !s.techs[def.requiresTech]) return fail(`Requires ${TECHS[def.requiresTech].name}`);
  const cost = facilityNextCost(id, s.facilities[id]);
  if (cost === null) return fail('Maxed out');
  return charge(s, cost, dry, () => {
    s.facilities[id]++;
    addLog(s, `${def.name} upgraded.`);
  });
}

export function techLockReason(s: GameState, id: TechId): string | null {
  const def = TECHS[id];
  if (s.techs[id]) return 'Owned';
  const missing = (def.requires ?? []).filter((r) => !s.techs[r]);
  if (missing.length) return `Requires ${missing.map((r) => TECHS[r].name).join(', ')}`;
  if (def.comingSoon) return 'Coming soon';
  return null;
}

export function buyTech(s: GameState, id: TechId, dry = false): Result {
  const lock = techLockReason(s, id);
  if (lock) return fail(lock);
  const def = TECHS[id];
  return charge(s, def.cost, dry, () => {
    s.techs[id] = true;
    if (id === 'wellPad') {
      const home = s.fields[0];
      home.slots = Math.max(home.slots, ECON.padSlotsWithPad);
    }
    addLog(s, `Unlocked: ${def.name}.`, 'good');
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
  if (!f.developed) return fail('Field not developed');
  const slot = freeSlot(s, f);
  if (slot === null) return fail(s.techs.wellPad ? 'Pad is full' : 'Build a well pad first');
  return charge(s, drillCost(s, fieldId), dry, () => {
    const n = fieldWells(s, f.id).length + 1;
    const prefix = f.name.split(' ')[0];
    let name = `${prefix}-${n}`;
    for (let i = n; s.wells.some((w) => w.name === name); i++) name = `${prefix}-${i + 1}`;
    const w = makeWell(s, s.nextId++, f, slot, name);
    w.job = { kind: 'drill', daysLeft: ECON.drillDays, total: ECON.drillDays };
    s.wells.push(w);
    s.stats.wellsDrilled++;
    addLog(s, `Rig mobilised: spudding ${name}.`);
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
  if (!s.techs.wellPad) return fail('Build a well pad first');
  const f = fieldById(s, fieldId);
  if (!f.developed) return fail('Field not developed');
  const cost = expandPadCost(s, fieldId);
  if (cost === null) return fail('Pad at max size');
  return charge(s, cost, dry, () => {
    f.slots += 2;
    addLog(s, `${f.name} pad expanded to ${f.slots} slots.`);
  });
}

export function liftLockReason(s: GameState, lift: LiftType): string | null {
  const def = LIFTS[lift];
  if (def.requiresTech && !s.techs[def.requiresTech]) return `Requires ${TECHS[def.requiresTech].name}`;
  if (def.requiresFacility && s.facilities[def.requiresFacility] < 1)
    return `Requires ${FACILITIES[def.requiresFacility].name}`;
  return null;
}

export function setLift(s: GameState, wellId: number, lift: LiftType, dry = false): Result {
  const w = getWell(s, wellId);
  if (typeof w === 'string') return fail(w);
  if (w.job) return fail('Well is busy');
  if (w.status === 'injector') return fail('Well is an injector');
  if (w.status === 'failed') return fail('Repair first');
  if (w.lift === lift) return fail('Already installed');
  const lock = liftLockReason(s, lift);
  if (lock) return fail(lock);
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
  const w = getWell(s, wellId);
  if (typeof w === 'string') return fail(w);
  if (w.job) return fail('Well is busy');
  if (w.status !== 'active') return fail('Well must be producing');
  if (w.fracCount >= ECON.fracMax) return fail('No more frac stages');
  return charge(s, fracCost(w), dry, () => {
    w.job = { kind: 'frac', daysLeft: ECON.fracDays, total: ECON.fracDays };
  });
}

export function convertToInjector(s: GameState, wellId: number, dry = false): Result {
  if (!s.techs.waterflood) return fail('Requires Waterflood');
  const w = getWell(s, wellId);
  if (typeof w === 'string') return fail(w);
  if (w.job) return fail('Well is busy');
  if (w.status === 'injector') return fail('Already an injector');
  if (w.status === 'failed') return fail('Repair first');
  return charge(s, ECON.convertCost, dry, () => {
    w.status = 'active';
    w.job = { kind: 'convert', daysLeft: ECON.convertDays, total: ECON.convertDays };
  });
}

export function toggleShutIn(s: GameState, wellId: number, dry = false): Result {
  const w = getWell(s, wellId);
  if (typeof w === 'string') return fail(w);
  if (w.job) return fail('Well is busy');
  if (w.status !== 'active' && w.status !== 'shutin') return fail('Not possible now');
  if (!dry) {
    w.status = w.status === 'active' ? 'shutin' : 'active';
    addLog(s, `${w.name} ${w.status === 'shutin' ? 'shut in' : 'reopened'}.`);
  }
  return { ok: true, cost: 0 };
}

export function plugWell(s: GameState, wellId: number, dry = false): Result {
  const w = getWell(s, wellId);
  if (typeof w === 'string') return fail(w);
  if (w.job) return fail('Well is busy');
  return charge(s, ECON.plugCost, dry, () => {
    s.wells = s.wells.filter((x) => x.id !== w.id);
    addLog(s, `${w.name} plugged and abandoned. Slot freed.`);
  });
}

export function serviceWell(s: GameState, wellId: number, dry = false): Result {
  const w = getWell(s, wellId);
  if (typeof w === 'string') return fail(w);
  if (w.job) return fail('Well is busy');
  if (w.status === 'failed') return fail('Needs repair');
  if (w.condition > 0.97) return fail('In good shape');
  return charge(s, serviceCost(w), dry, () => {
    w.condition = 1;
  });
}

export function repairWell(s: GameState, wellId: number, dry = false): Result {
  const w = getWell(s, wellId);
  if (typeof w === 'string') return fail(w);
  if (w.status !== 'failed') return fail('Not failed');
  if (w.job) return fail('Repair under way');
  return charge(s, repairCost(w), dry, () => {
    w.job = { kind: 'repair', daysLeft: ECON.repairDays, total: ECON.repairDays };
  });
}

// ---------- exploration ----------

export function surveyCost(kind: 2 | 3): number {
  return kind === 2 ? EXPLORATION.survey2dCost : EXPLORATION.survey3dCost;
}

export function surveyBlock(s: GameState, block: number, kind: 2 | 3, dry = false): Result {
  if (!s.techs.exploration) return fail('Requires Exploration license');
  if (kind === 3 && !s.techs.seismic3d) return fail('Requires 3D seismic');
  const ex = s.exploration;
  if (block < 0 || block >= ex.blocks.length) return fail('Outside licence area');
  if (ex.blocks[block] >= kind) return fail('Already surveyed');
  if (ex.surveys.some((sv) => sv.block === block)) return fail('Survey under way');
  const days = kind === 2 ? EXPLORATION.survey2dDays : EXPLORATION.survey3dDays;
  return charge(s, surveyCost(kind), dry, () => {
    ex.surveys.push({ block, kind, daysLeft: days, total: days });
    addLog(s, `${kind}D seismic crew deployed.`);
  });
}

export function wildcatCost(s: GameState, x: number, y: number): number {
  const c = s.exploration.cells[y * s.exploration.w + x];
  return Math.round(EXPLORATION.wildcatCost * EXPLORATION.terrainCostMult[c.terrain] * (c.lead?.costMult ?? 1.2));
}

export function drillWildcat(s: GameState, x: number, y: number, dry = false): Result {
  if (!s.techs.exploration) return fail('Requires Exploration license');
  const ex = s.exploration;
  if (x < 0 || y < 0 || x >= ex.w || y >= ex.h) return fail('Outside licence area');
  if (ex.wildcat) return fail('Exploration rig is busy');
  const c = ex.cells[y * ex.w + x];
  if (c.terrain === 3) return fail('Cannot drill in a lake');
  if (c.drilled !== 'none') return fail('Already drilled');
  if (Math.abs(x - ex.hubX) <= 1 && Math.abs(y - ex.hubY) <= 1) return fail('Too close to the hub');
  return charge(s, wildcatCost(s, x, y), dry, () => {
    ex.wildcat = { x, y, daysLeft: EXPLORATION.wildcatDays, total: EXPLORATION.wildcatDays };
    addLog(s, `Wildcat spudded at ${x},${y}. Fingers crossed.`);
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
  if (f.developed) return fail('Already developed');
  if (f.devJob) return fail('Construction under way');
  if (!s.techs.wellPad) return fail('Build a well pad first');
  const active = s.fields.filter((x) => x.developed || x.devJob);
  if (active.length >= EXPLORATION.maxFields) return fail(`Hub supports ${EXPLORATION.maxFields} fields`);
  return charge(s, developCost(s, fieldId), dry, () => {
    const used = new Set(active.map((x) => x.padIndex));
    let pad = 1;
    while (used.has(pad)) pad++;
    f.padIndex = pad;
    f.devJob = { daysLeft: EXPLORATION.developDays, total: EXPLORATION.developDays };
    addLog(s, `Building pad and flowline to ${f.name}.`);
  });
}

export function convertToProducer(s: GameState, wellId: number, dry = false): Result {
  const w = getWell(s, wellId);
  if (typeof w === 'string') return fail(w);
  if (w.job) return fail('Well is busy');
  if (w.status !== 'injector') return fail('Not an injector');
  return charge(s, ECON.convertCost, dry, () => {
    w.status = 'active';
    w.job = { kind: 'lift', daysLeft: ECON.convertDays, total: ECON.convertDays, lift: w.lift };
    addLog(s, `${w.name} going back on production.`);
  });
}
