import { ECON, FACILITIES, LIFTS, MARKET, OFFSHORE, RESERVOIR } from './balance';
import type { FacilityId, Field, GameState, LiftType, Well } from './types';

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function recoveryFactor(f: Field): number {
  return f.rfBase + f.rfFrac + RESERVOIR.floodRfGain * f.floodMaturity;
}

/** Technically recoverable oil (hidden truth), bbl. */
export function recoverable(f: Field): number {
  return f.ooip * recoveryFactor(f);
}

/** Fraction of recoverable oil already produced. */
export function depletion(f: Field): number {
  return clamp(f.np / recoverable(f), 0, 0.999);
}

/**
 * Normalised reservoir pressure 0..1. q ∝ (1 - x)^n reproduces Arps
 * hyperbolic decline with b = 1 - 1/n, but stays a function of state so
 * upgrades and offline catch-up compose cleanly.
 */
export function pressure(f: Field): number {
  const x = depletion(f) * (1 - RESERVOIR.floodPressureRelief * f.flood);
  return Math.pow(1 - x, f.declineN);
}

export function waterCut(f: Field, w: Well): number {
  const x = depletion(f);
  const x50 = f.wcX50 - RESERVOIR.floodWcShift * f.floodMaturity;
  const s = 1 / (1 + Math.exp(-(x - x50) / f.wcWidth));
  return clamp(f.wcMax * s + w.wcBias, 0, 0.99);
}

export function conditionMult(condition: number): number {
  return condition >= 0.5 ? 1 : 0.5 + condition;
}

export function liftCapacity(f: Field, w: Well): number {
  const def = LIFTS[w.lift];
  let cap = def.capacity;
  if (w.lift === 'flowing') cap *= Math.pow(pressure(f), RESERVOIR.flowingPressureExp);
  if (f.offshore) cap *= OFFSHORE.liftCapMult;
  return cap * conditionMult(w.condition);
}

export function reservoirLiquid(f: Field, w: Well): number {
  return w.pi * pressure(f) * (1 + w.stim);
}

export interface ReserveEstimate {
  p90: number;
  p50: number;
  p10: number;
  sigma: number;
}

const Z90 = 1.2816;

/** Estimated ultimate recovery. Uncertainty narrows as production history accumulates. */
export function reserveEstimate(f: Field): ReserveEstimate {
  const r = recoverable(f);
  const info = f.np / r;
  const sigma = f.sigma0 * (0.08 + 0.92 * Math.exp(-6 * info));
  const p50 = r * Math.exp(f.estBias * sigma);
  return { p90: p50 * Math.exp(-Z90 * sigma), p50, p10: p50 * Math.exp(Z90 * sigma), sigma };
}

export function estimateFromSigma(trueValue: number, bias: number, sigma: number): ReserveEstimate {
  const p50 = trueValue * Math.exp(bias * sigma);
  return { p90: p50 * Math.exp(-Z90 * sigma), p50, p10: p50 * Math.exp(Z90 * sigma), sigma };
}

// ---------- facilities ----------

export function facilityValue(id: FacilityId, level: number): number {
  const def = FACILITIES[id];
  if (def.kind === 'levels') return def.levels![Math.min(level, def.levels!.length - 1)].value;
  return def.per!.value * level;
}

export function facilityOpex(id: FacilityId, level: number): number {
  const def = FACILITIES[id];
  if (def.kind === 'levels') return def.levels![Math.min(level, def.levels!.length - 1)].opexDay;
  return def.per!.opexDay * level;
}

/** Cost of the next level/unit, or null when maxed. */
export function facilityNextCost(id: FacilityId, level: number): number | null {
  const def = FACILITIES[id];
  if (def.kind === 'levels') {
    const next = def.levels![level + 1];
    return next ? next.cost : null;
  }
  const per = def.per!;
  if (level >= per.max) return null;
  return Math.round(per.baseCost * Math.pow(per.growth, level));
}

export function facilityNextValue(id: FacilityId, level: number): number | null {
  if (facilityNextCost(id, level) === null) return null;
  return facilityValue(id, level + 1);
}

export function cap(s: GameState, id: FacilityId): number {
  return facilityValue(id, s.facilities[id]);
}

export function exportCapacity(s: GameState): number {
  return cap(s, 'trucks') + cap(s, 'pipeline');
}

export function waterHandlingCapacity(s: GameState): number {
  return injectionCapacity(s) + cap(s, 'swd') + cap(s, 'waterTrucks');
}

/** Onshore injection: pump capacity, limited by how many onshore injectors are online. */
export function injectionCapacity(s: GameState): number {
  const injectors = s.wells.filter((w) => w.status === 'injector' && !w.job && !fieldById(s, w.fieldId).offshore).length;
  return Math.min(cap(s, 'injection'), injectors * ECON.injectivity);
}

// ---------- wells ----------

export function fieldById(s: GameState, id: number): Field {
  const f = s.fields.find((x) => x.id === id);
  if (!f) throw new Error(`no field ${id}`);
  return f;
}

export function wellById(s: GameState, id: number): Well | undefined {
  return s.wells.find((w) => w.id === id);
}

export function isProducing(w: Well): boolean {
  return w.status === 'active' && !w.job;
}

export function fieldWells(s: GameState, fieldId: number): Well[] {
  return s.wells.filter((w) => w.fieldId === fieldId);
}

export function freeSlot(s: GameState, f: Field): number | null {
  const used = new Set(fieldWells(s, f.id).map((w) => w.slot));
  for (let i = 0; i < f.slots; i++) if (!used.has(i)) return i;
  return null;
}

export function isOffshoreWell(s: GameState, w: Well): boolean {
  return !!fieldById(s, w.fieldId).offshore;
}

export function fracCost(s: GameState, w: Well): number {
  const k = isOffshoreWell(s, w) ? OFFSHORE.fracCostMult : 1;
  return Math.round(ECON.fracBaseCost * Math.pow(ECON.fracGrowth, w.fracCount) * k);
}

export function serviceCost(s: GameState, w: Well): number {
  const k = isOffshoreWell(s, w) ? OFFSHORE.serviceMult : 1;
  return Math.round((ECON.serviceBase + LIFTS[w.lift].cost * ECON.serviceFactor * (1 - w.condition)) * k);
}

export function repairCost(s: GameState, w: Well): number {
  const k = isOffshoreWell(s, w) ? OFFSHORE.repairMult : 1;
  return Math.round(Math.max(ECON.repairMin, LIFTS[w.lift].cost * ECON.repairFactor) * k);
}

/** Lift purchase price; offshore installs need the platform rig and cost more. */
export function liftCost(s: GameState, w: Well, lift: LiftType): number {
  return Math.round(LIFTS[lift].cost * (isOffshoreWell(s, w) ? OFFSHORE.liftCostMult : 1));
}

/** Daily opex of a well in its current state. */
export function wellOpex(s: GameState, w: Well): number {
  const off = isOffshoreWell(s, w);
  if (w.status === 'injector') return w.job ? 0 : off ? OFFSHORE.injectorOpexDay : ECON.injectorOpexDay;
  if (w.status === 'shutin' || w.status === 'failed') return off ? OFFSHORE.shutinOpexDay : ECON.shutinOpexDay;
  if (w.job) return 0;
  return LIFTS[w.lift].opexDay * (off ? OFFSHORE.wellOpexMult : 1);
}

export function marketDepth(s: GameState): number {
  return MARKET.depthLocal + MARKET.depthPipeline[s.facilities.pipeline];
}

/** Rough daily net contribution of one producing well at current prices and plant costs. */
export function wellNetPerDay(s: GameState, w: Well): number {
  const wf = s.flows.wells[w.id];
  if (!wf || w.status !== 'active' || w.job) return 0;
  if (isOffshoreWell(s, w)) return offshoreWellNet(s, w);
  const fl = s.flows;
  const lift = LIFTS[w.lift];
  const waterCost = fl.water > 0 ? (fl.costs.water ?? 0) / fl.water : ECON.waterTruckPerBbl;
  const transport = fl.sold > 0 ? (fl.costs.transport ?? 0) / fl.sold : ECON.truckPerBbl;
  const price = fl.salePrice || s.market.price;
  const soldShare = fl.gas > 0 ? Math.min(1, cap(s, 'compressor') / fl.gas) : 0;
  const gasValue = soldShare * ECON.gasPricePerMcf - (1 - soldShare) * ECON.flarePerMcf;
  return wf.oil * (price - transport) + wf.gas * gasValue - lift.opexDay - wf.liquid * lift.powerPerBbl - wf.water * waterCost;
}

/**
 * Offshore version: oil at the realised price less a per-barrel share of the
 * tanker charter, lift power at the platform's diesel rate, water at the
 * platform's average handling cost. Gas is valued as turbine fuel.
 */
function offshoreWellNet(s: GameState, w: Well): number {
  const wf = s.flows.wells[w.id];
  const p = s.platforms.find((x) => x.fieldId === w.fieldId);
  const pf = p ? s.flows.platforms[p.id] : undefined;
  if (!wf || !pf) return 0;
  const price = s.flows.salePrice || s.market.price;
  const charter = pf.oil > 0 ? (pf.costs.charter ?? 0) / pf.oil : 0;
  const waterCost = pf.water > 0 ? (pf.costs.water ?? 0) / pf.water : OFFSHORE.overboardPerBbl;
  const lift = LIFTS[w.lift];
  const power = wf.liquid * lift.powerPerBbl * OFFSHORE.powerMult;
  return wf.oil * (price - charter) - wellOpex(s, w) - power - wf.water * waterCost;
}
