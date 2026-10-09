import type { MsgKey } from '../i18n/en';
import { msg } from './msg';
import type { GameState } from './types';

export interface Objective {
  id: string;
  key: MsgKey;
  done: (s: GameState) => boolean;
}

const producing = (s: GameState) => s.wells.filter((w) => w.status === 'active' && !w.job).length;
const onStream = (s: GameState) => s.fields.filter((f) => f.offshore && f.developed).length;

export const OBJECTIVES: Objective[] = [
  { id: 'truck', key: 'obj.truck', done: (s) => s.facilities.trucks >= 2 },
  { id: 'pad', key: 'obj.pad', done: (s) => s.techs.wellPad },
  { id: 'wells3', key: 'obj.wells3', done: (s) => producing(s) >= 3 },
  { id: 'sep', key: 'obj.sep', done: (s) => s.facilities.separator >= 1 },
  { id: 'prod100k', key: 'obj.prod100k', done: (s) => s.stats.oilProduced >= 100_000 },
  { id: 'explore', key: 'obj.explore', done: (s) => s.techs.exploration },
  { id: 'survey', key: 'obj.survey', done: (s) => s.exploration.blocks.filter((b) => b > 0).length >= 2 },
  { id: 'discover', key: 'obj.discover', done: (s) => s.stats.discoveries >= 1 },
  { id: 'develop', key: 'obj.develop', done: (s) => s.fields.filter((f) => f.developed).length >= 2 },
  { id: 'flood', key: 'obj.flood', done: (s) => s.flows.injected > 0 },
  { id: 'cash5m', key: 'obj.cash5m', done: (s) => s.cash >= 5_000_000 },
  { id: 'prod1m', key: 'obj.prod1m', done: (s) => s.stats.oilProduced >= 1_000_000 },
  { id: 'pipeline', key: 'obj.pipeline', done: (s) => s.facilities.pipeline >= 1 },
  { id: 'fields4', key: 'obj.fields4', done: (s) => s.fields.filter((f) => f.developed).length >= 4 },
  { id: 'prod5m', key: 'obj.prod5m', done: (s) => s.stats.oilProduced >= 5_000_000 },
  // Layer 2: the shelf.
  { id: 'shelf', key: 'obj.shelf', done: (s) => s.techs.offshore },
  { id: 'shelfSurvey', key: 'obj.shelfSurvey', done: (s) => !!s.shelf && s.shelf.blocks.some((b) => b > 0) },
  { id: 'shelfFind', key: 'obj.shelfFind', done: (s) => s.fields.some((f) => f.offshore) },
  { id: 'platform', key: 'obj.platform', done: (s) => onStream(s) >= 1 },
  { id: 'cargo', key: 'obj.cargo', done: (s) => s.stats.cargoes >= 1 },
  { id: 'turbine', key: 'obj.turbine', done: (s) => s.platforms.some((p) => p.modules.turbine > 0) },
  { id: 'deck', key: 'obj.deck', done: (s) => s.platforms.some((p) => p.deck > 0) },
  { id: 'platforms2', key: 'obj.platforms2', done: (s) => onStream(s) >= 2 },
  { id: 'prod25m', key: 'obj.prod25m', done: (s) => s.stats.oilProduced >= 25_000_000 },
  { id: 'cash250m', key: 'obj.cash250m', done: (s) => s.cash >= 250_000_000 },
];

export function checkObjectives(s: GameState): void {
  for (const o of OBJECTIVES) {
    if (s.objectivesDone.includes(o.id) || !o.done(s)) continue;
    s.objectivesDone.push(o.id);
    s.log.unshift({ day: s.day, msg: msg('log.objective', { goal: msg(o.key) }), kind: 'good' });
  }
}

export function pendingObjectives(s: GameState, n = 3): Objective[] {
  return OBJECTIVES.filter((o) => !s.objectivesDone.includes(o.id)).slice(0, n);
}
