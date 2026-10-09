import { TIME } from './balance';
import { SAVE_VERSION, emptyFlows, newWeather } from './newGame';
import { msg } from './msg';
import { step } from './sim';
import type { GameState, LogKind } from './types';

const KEY = 'drawdown.save';

export function serialize(s: GameState): string {
  const { flows: _flows, ...rest } = s;
  return JSON.stringify({ ...rest, savedAt: Date.now() });
}

export function deserialize(json: string): GameState | null {
  try {
    const data = migrate(JSON.parse(json));
    if (!data || data.version !== SAVE_VERSION) return null;
    data.flows = emptyFlows();
    return data;
  } catch {
    return null;
  }
}

/** Bring older saves up to the current shape. Unknown versions are dropped. */
function migrate(data: GameState | null): GameState | null {
  if (!data) return null;
  if (data.version === 1) {
    // v1 kept log entries as finished English text; show them verbatim.
    const old = data.log as unknown as { day: number; text: string; kind: LogKind }[];
    data.log = old.map((e) => ({ day: e.day, kind: e.kind, msg: msg('log.raw', { text: e.text }) }));
    data.version = 2;
  }
  if (data.version === 2) {
    // v3 adds the shelf: no map until the license is bought, no platforms yet.
    data.shelf = null;
    data.platforms = [];
    data.weather = newWeather();
    data.stats.cargoes = 0;
    data.version = 3;
  }
  return data;
}

export function saveGame(s: GameState): void {
  try {
    localStorage.setItem(KEY, serialize(s));
    s.savedAt = Date.now();
  } catch {
    /* storage unavailable (private mode / quota) — keep playing */
  }
}

export function loadGame(): GameState | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? deserialize(raw) : null;
  } catch {
    return null;
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export interface OfflineReport {
  days: number;
  cash: number;
  oil: number;
  sold: number;
}

/** Catch the world up after the tab was closed. Capped so a long absence can't drain every field. */
export function simulateOffline(s: GameState, seconds: number): OfflineReport | null {
  const days = Math.min(seconds * TIME.daysPerSecond, TIME.maxOfflineDays);
  if (days < 1) return null;
  const cash0 = s.cash, oil0 = s.stats.oilProduced, sold0 = s.stats.oilSold;
  let left = days;
  while (left > 1e-9) {
    const dt = Math.min(TIME.offlineStepDays, left);
    step(s, dt);
    left -= dt;
  }
  return { days, cash: s.cash - cash0, oil: s.stats.oilProduced - oil0, sold: s.stats.oilSold - sold0 };
}
