import type { GameState, MapId } from '../game/types';
import type { Lang } from '../i18n';
import type { ViewMode } from '../render/stage';

export interface UiState {
  view: ViewMode;
  /** Selected onshore field (site view). */
  field: number;
  /** Selected platform (sea view). */
  platform: number | null;
  well: number | null;
  cell: { x: number; y: number } | null;
  /** Which exploration map the map view shows. */
  map: MapId;
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
  selectPlatform(id: number): void;
  selectCell(x: number, y: number): void;
  setMap(map: MapId): void;
  setSpeed(v: number): void;
  newGame(): void;
  save(): void;
  /** Download the current game as a file. */
  exportSave(): void;
  /** Replace the current game with one read from a file, then restart. */
  loadState(state: GameState): void;
  /** Switch UI language and rebuild the panels. */
  setLang(lang: Lang): void;
}

/** The field the left panel is about: the selected platform's field at sea, the selected field on land. */
export function currentField(ctx: Ctx): number {
  if (ctx.ui.view === 'sea') {
    const p = ctx.s.platforms.find((x) => x.id === ctx.ui.platform);
    if (p) return p.fieldId;
  }
  return ctx.ui.field;
}
