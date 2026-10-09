import type { Msg } from './msg';
import type { GameState, LogKind } from './types';

export function addLog(s: GameState, m: Msg, kind: LogKind = 'info'): void {
  s.log.unshift({ day: s.day, msg: m, kind });
  if (s.log.length > 80) s.log.length = 80;
}
