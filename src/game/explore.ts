import { EXPLORATION } from './balance';
import { clamp, estimateFromSigma, type ReserveEstimate } from './reservoir';
import type { Cell, GameState } from './types';

/** What the player can know about the map — all numbers shown in UI come from here. */

export function blockOf(s: GameState, x: number, y: number): number {
  const bw = s.exploration.w / EXPLORATION.block;
  return Math.floor(y / EXPLORATION.block) * bw + Math.floor(x / EXPLORATION.block);
}

export function cellAt(s: GameState, x: number, y: number): Cell {
  return s.exploration.cells[y * s.exploration.w + x];
}

export function surveyLevel(s: GameState, x: number, y: number): number {
  return s.exploration.blocks[blockOf(s, x, y)];
}

export function leadVisible(s: GameState, x: number, y: number): boolean {
  const c = cellAt(s, x, y);
  if (!c.lead) return false;
  const lvl = surveyLevel(s, x, y);
  return lvl === 3 || (lvl === 2 && c.lead.detect2d);
}

/** Estimated chance of success for a mapped lead. */
export function cosEstimate(s: GameState, x: number, y: number): number | null {
  if (!leadVisible(s, x, y)) return null;
  const c = cellAt(s, x, y);
  const lvl = surveyLevel(s, x, y);
  const est = lvl === 3 ? c.lead!.cos + c.lead!.noise3d * EXPLORATION.noise3d : c.lead!.cos + c.lead!.noise2d * EXPLORATION.noise2d;
  return clamp(est, 0.02, 0.95);
}

/** Geological chance heatmap for surveyed cells. */
export function heatEstimate(s: GameState, x: number, y: number): number | null {
  const lvl = surveyLevel(s, x, y);
  if (!lvl) return null;
  const c = cellAt(s, x, y);
  return clamp(c.prior + c.heatNoise * (lvl === 3 ? 0.04 : 0.12), 0, 1);
}

/** Recoverable-volume estimate for a lead (3D seismic only). */
export function leadSizeEstimate(s: GameState, x: number, y: number): ReserveEstimate | null {
  if (surveyLevel(s, x, y) !== 3 || !leadVisible(s, x, y)) return null;
  const l = cellAt(s, x, y).lead!;
  return estimateFromSigma(l.ooip * l.rfBase, l.sizeBias, 0.9);
}

/** Faint regional prior visible through the fog (block-averaged, noisy). */
export function regionalHint(s: GameState, block: number): number {
  const ex = s.exploration;
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

export function isDrillable(s: GameState, x: number, y: number): boolean {
  const ex = s.exploration;
  const c = cellAt(s, x, y);
  return c.terrain !== 3 && c.drilled === 'none' && !(Math.abs(x - ex.hubX) <= 1 && Math.abs(y - ex.hubY) <= 1);
}
