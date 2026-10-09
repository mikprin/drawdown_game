import { DECK, MODULES, OFFSHORE, SHELF } from './balance';
import { cellAt } from './explore';
import { fieldById, fieldWells } from './reservoir';
import type { Field, GameState, ModuleId, Platform, Well, WellJobKind } from './types';

/** Platform derivations: deck space, module capacities, distances, the single rig. */

export const MODULE_IDS: ModuleId[] = ['wellbay', 'separator', 'storage', 'waterTreat', 'injection', 'turbine', 'gasInj'];

/** Jobs that need the platform's drilling rig. Fracs come from a stimulation vessel. */
const RIG_JOBS: WellJobKind[] = ['drill', 'lift', 'repair', 'convert'];

export function platformById(s: GameState, id: number): Platform | undefined {
  return s.platforms.find((p) => p.id === id);
}

export function platformOfField(s: GameState, fieldId: number): Platform | undefined {
  return s.platforms.find((p) => p.fieldId === fieldId);
}

export function newModules(): Record<ModuleId, number> {
  return { wellbay: 0, separator: 0, storage: 0, waterTreat: 0, injection: 0, turbine: 0, gasInj: 0 };
}

export function moduleValue(p: Platform, id: ModuleId): number {
  return MODULES[id].levels[p.modules[id]].value;
}

export function deckArea(p: Platform): number {
  return DECK[p.deck].area;
}

export function deckUsed(p: Platform): number {
  let used = 0;
  for (const id of MODULE_IDS) used += MODULES[id].levels[p.modules[id]].area;
  return used;
}

/** Extra deck area the next level of a module needs, or null when maxed. */
export function moduleNextArea(p: Platform, id: ModuleId): number | null {
  const lv = MODULES[id].levels;
  const next = lv[p.modules[id] + 1];
  return next ? next.area - lv[p.modules[id]].area : null;
}

export function moduleNextValue(p: Platform, id: ModuleId): number | null {
  return MODULES[id].levels[p.modules[id] + 1]?.value ?? null;
}

export function modulesOpex(p: Platform): number {
  let opex = DECK[p.deck].opexDay;
  for (const id of MODULE_IDS) opex += MODULES[id].levels[p.modules[id]].opexDay;
  return opex;
}

/** Platform is on stream: built and not being decommissioned. */
export function platformLive(s: GameState, p: Platform): boolean {
  const f = fieldById(s, p.fieldId);
  return f.developed && !f.devJob && !p.decom;
}

/** Cells from the shore base. */
export function shelfDistance(s: GameState, f: Field): number {
  const ex = s.shelf!;
  return Math.hypot(f.cellX - ex.hubX, f.cellY - ex.hubY);
}

/** Water-depth multiplier on platform construction and removal. */
export function depthMult(s: GameState, f: Field): number {
  return OFFSHORE.depthMult[cellAt(s.shelf!, f.cellX, f.cellY).terrain] ?? 1;
}

export function waterDepthClass(s: GameState, f: Field): number {
  return cellAt(s.shelf!, f.cellX, f.cellY).terrain;
}

export function installCost(s: GameState, f: Field): number {
  return Math.round((OFFSHORE.installBase + OFFSHORE.installPerCell * shelfDistance(s, f)) * depthMult(s, f));
}

export function decomCost(s: GameState, p: Platform): number {
  const f = fieldById(s, p.fieldId);
  return Math.round((OFFSHORE.decomBase + OFFSHORE.decomPerWell * fieldWells(s, f.id).length) * depthMult(s, f));
}

/** One-way sailing time between the platform and the export port. */
export function legDays(s: GameState, p: Platform): number {
  return OFFSHORE.legBase + OFFSHORE.legPerCell * shelfDistance(s, fieldById(s, p.fieldId));
}

/** The well currently using the platform rig, if any. */
export function rigUser(s: GameState, fieldId: number): Well | undefined {
  return fieldWells(s, fieldId).find((w) => w.job && RIG_JOBS.includes(w.job.kind));
}

export function needsRig(kind: WellJobKind): boolean {
  return RIG_JOBS.includes(kind);
}

export function stormy(s: GameState): boolean {
  return s.weather.storm > 0;
}

export function wildcatShelfCost(s: GameState, x: number, y: number): number {
  const c = cellAt(s.shelf!, x, y);
  return Math.round(SHELF.wildcatCost * SHELF.terrainCostMult[c.terrain] * (c.lead?.costMult ?? 1.2));
}
