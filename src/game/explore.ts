import { EXPLORATION, SHELF } from './balance';
import { clamp, estimateFromSigma, type ReserveEstimate } from './reservoir';
import type { Cell, Exploration, GameState, MapId } from './types';

/** What the player can know about a map — all numbers shown in UI come from here. */

export function mapOf(s: GameState, map: MapId): Exploration {
  if (map === 'shelf') {
    if (!s.shelf) throw new Error('no shelf map');
    return s.shelf;
  }
  return s.exploration;
}

/** Survey, wildcat and terrain numbers for a map. */
export function mapCfg(map: MapId) {
  return map === 'shelf' ? SHELF : EXPLORATION;
}

/** Terrain codes 3 (lake), 4 (coast) and 8 (slope) cannot be drilled. */
export function undrillable(terrain: number): boolean {
  return terrain === 3 || terrain === 4 || terrain === 8;
}

export function blockOf(ex: Exploration, x: number, y: number): number {
  const bw = ex.w / EXPLORATION.block;
  return Math.floor(y / EXPLORATION.block) * bw + Math.floor(x / EXPLORATION.block);
}

export function cellAt(ex: Exploration, x: number, y: number): Cell {
  return ex.cells[y * ex.w + x];
}

export function surveyLevel(ex: Exploration, x: number, y: number): number {
  return ex.blocks[blockOf(ex, x, y)];
}

export function leadVisible(ex: Exploration, x: number, y: number): boolean {
  const c = cellAt(ex, x, y);
  if (!c.lead) return false;
  const lvl = surveyLevel(ex, x, y);
  return lvl === 3 || (lvl === 2 && c.lead.detect2d);
}

/** Estimated chance of success for a mapped lead. */
export function cosEstimate(ex: Exploration, x: number, y: number): number | null {
  if (!leadVisible(ex, x, y)) return null;
  const c = cellAt(ex, x, y);
  const lvl = surveyLevel(ex, x, y);
  const est = lvl === 3 ? c.lead!.cos + c.lead!.noise3d * EXPLORATION.noise3d : c.lead!.cos + c.lead!.noise2d * EXPLORATION.noise2d;
  return clamp(est, 0.02, 0.95);
}

/** Geological chance heatmap for surveyed cells. */
export function heatEstimate(ex: Exploration, x: number, y: number): number | null {
  const lvl = surveyLevel(ex, x, y);
  if (!lvl) return null;
  const c = cellAt(ex, x, y);
  return clamp(c.prior + c.heatNoise * (lvl === 3 ? 0.04 : 0.12), 0, 1);
}

/** Recoverable-volume estimate for a lead (3D seismic only). */
export function leadSizeEstimate(ex: Exploration, x: number, y: number): ReserveEstimate | null {
  if (surveyLevel(ex, x, y) !== 3 || !leadVisible(ex, x, y)) return null;
  const l = cellAt(ex, x, y).lead!;
  return estimateFromSigma(l.ooip * l.rfBase, l.sizeBias, 0.9);
}

/** Faint regional prior visible through the fog (block-averaged, noisy). */
export function regionalHint(ex: Exploration, block: number): number {
  const bw = ex.w / EXPLORATION.block;
  const bx = (block % bw) * EXPLORATION.block, by = Math.floor(block / bw) * EXPLORATION.block;
  let sum = 0, n = 0;
  for (let y = by; y < by + EXPLORATION.block; y++)
    for (let x = bx; x < bx + EXPLORATION.block; x++) {
      const c = ex.cells[y * ex.w + x];
      sum += c.prior + c.heatNoise * 0.08;
      n++;
    }
  return clamp(sum / n, 0, 1);
}

export function isDrillable(ex: Exploration, x: number, y: number): boolean {
  const c = cellAt(ex, x, y);
  return !undrillable(c.terrain) && c.drilled === 'none' && !(Math.abs(x - ex.hubX) <= 1 && Math.abs(y - ex.hubY) <= 1);
}
