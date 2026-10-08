import type { GameState } from './types';

export interface Objective {
  id: string;
  text: string;
  done: (s: GameState) => boolean;
}

const producing = (s: GameState) => s.wells.filter((w) => w.status === 'active' && !w.job).length;

export const OBJECTIVES: Objective[] = [
  { id: 'truck', text: 'Add a second oil truck', done: (s) => s.facilities.trucks >= 2 },
  { id: 'pad', text: 'Build a well pad', done: (s) => s.techs.wellPad },
  { id: 'wells3', text: 'Run 3 producing wells', done: (s) => producing(s) >= 3 },
  { id: 'sep', text: 'Upgrade the separator', done: (s) => s.facilities.separator >= 1 },
  { id: 'prod100k', text: 'Produce 100k bbl', done: (s) => s.stats.oilProduced >= 100_000 },
  { id: 'explore', text: 'Get an exploration license', done: (s) => s.techs.exploration },
  { id: 'survey', text: 'Shoot a seismic survey', done: (s) => s.exploration.blocks.filter((b) => b > 0).length >= 2 },
  { id: 'discover', text: 'Make a discovery', done: (s) => s.stats.discoveries >= 1 },
  { id: 'develop', text: 'Develop a second field', done: (s) => s.fields.filter((f) => f.developed).length >= 2 },
  { id: 'flood', text: 'Start a waterflood', done: (s) => s.flows.injected > 0 },
  { id: 'cash5m', text: 'Hold $5M in cash', done: (s) => s.cash >= 5_000_000 },
  { id: 'prod1m', text: 'Produce 1M bbl', done: (s) => s.stats.oilProduced >= 1_000_000 },
  { id: 'pipeline', text: 'Build the export pipeline', done: (s) => s.facilities.pipeline >= 1 },
  { id: 'fields4', text: 'Operate 4 fields', done: (s) => s.fields.filter((f) => f.developed).length >= 4 },
  { id: 'prod5m', text: 'Produce 5M bbl', done: (s) => s.stats.oilProduced >= 5_000_000 },
];

export function checkObjectives(s: GameState): void {
  for (const o of OBJECTIVES) {
    if (s.objectivesDone.includes(o.id) || !o.done(s)) continue;
    s.objectivesDone.push(o.id);
    s.log.unshift({ day: s.day, text: `Objective complete: ${o.text}.`, kind: 'good' });
  }
}

export function pendingObjectives(s: GameState, n = 3): Objective[] {
  return OBJECTIVES.filter((o) => !s.objectivesDone.includes(o.id)).slice(0, n);
}
