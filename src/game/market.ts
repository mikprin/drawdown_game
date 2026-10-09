import type { GameState } from './types';

export function salePrice(s: GameState): number {
  return s.market.price * (1 - s.market.impact);
}

export function isSelling(s: GameState): boolean {
  const m = s.market;
  return m.sellMode === 'auto' || (m.sellMode === 'threshold' && salePrice(s) >= m.threshold);
}
