import type { GameState } from '../game/types';
import type { ViewMode } from '../render/stage';

export interface UiState {
  view: ViewMode;
  field: number;
  well: number | null;
  cell: { x: number; y: number } | null;
  speed: number;
}

/** Shared handle every panel gets: current game, UI selection, and how to mutate. */
export interface Ctx {
  readonly s: GameState;
  ui: UiState;
  /** Apply a player action, then refresh UI and scene immediately. */
  act(fn: (s: GameState) => unknown): void;
  setView(v: ViewMode): void;
  selectWell(id: number | null): void;
  selectField(id: number): void;
  selectCell(x: number, y: number): void;
  setSpeed(v: number): void;
  newGame(): void;
  save(): void;
}
