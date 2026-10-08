import { describe, expect, it } from 'vitest';
import {
  buyFacility, buyTech, convertToInjector, developField, drillWell, drillWildcat, setSellMode,
  surveyBlock,
} from '../src/game/actions';
import { newGame, SAVE_VERSION } from '../src/game/newGame';
import { recoverable, reserveEstimate, waterCut } from '../src/game/reservoir';
import { deserialize, serialize, simulateOffline } from '../src/game/save';
import { step } from '../src/game/sim';
import type { GameState } from '../src/game/types';

function run(s: GameState, days: number, dt = 0.5) {
  for (let t = 0; t < days; t += dt) step(s, dt);
}

function rich(seed = 7): GameState {
  const s = newGame(seed);
  s.cash = 1e9;
  return s;
}

describe('production', () => {
  it('produces oil and earns money from the first day', () => {
    const s = newGame(1);
    run(s, 5, 0.1);
    expect(s.stats.oilProduced).toBeGreaterThan(250);
    expect(s.cash).toBeGreaterThan(60_000);
  });

  it('declines over time when the plant is not a bottleneck', () => {
    const s = rich();
    s.facilities.trucks = 20;
    s.facilities.waterTrucks = 20;
    const rates: number[] = [];
    for (let i = 0; i < 40; i++) {
      run(s, 50);
      rates.push(s.flows.oil);
    }
    for (let i = 1; i < rates.length; i++) expect(rates[i]).toBeLessThanOrEqual(rates[i - 1] + 1e-6);
    expect(rates[rates.length - 1]).toBeLessThan(rates[0] * 0.6);
  });

  it('water cut rises with depletion', () => {
    const s = rich();
    const f = s.fields[0], w = s.wells[0];
    const wc0 = waterCut(f, w);
    f.np = recoverable(f) * 0.7;
    expect(waterCut(f, w)).toBeGreaterThan(wc0 + 0.3);
  });

  it('respects separator, storage and water limits', () => {
    const s = rich();
    buyTech(s, 'wellPad');
    for (let i = 0; i < 3; i++) drillWell(s, 1);
    setSellMode(s, 'hold');
    for (let i = 0; i < 400; i++) {
      step(s, 0.5);
      const fl = s.flows;
      expect(fl.liquid).toBeLessThanOrEqual(fl.sepCap + 1e-6);
      expect(fl.water).toBeLessThanOrEqual(fl.waterCap + 1e-6);
      expect(s.storage).toBeLessThanOrEqual(fl.storageCap + 1e-6);
      expect(s.storage).toBeGreaterThanOrEqual(0);
    }
    expect(s.flows.bottleneck).toBe('storage');
  });

  it('waterflood raises recoverable reserves', () => {
    const s = rich();
    buyTech(s, 'wellPad');
    buyTech(s, 'waterflood');
    drillWell(s, 1);
    run(s, 20);
    const r0 = recoverable(s.fields[0]);
    buyFacility(s, 'injection');
    expect(convertToInjector(s, s.wells[1].id).ok).toBe(true);
    run(s, 400);
    expect(s.flows.injected).toBeGreaterThan(0);
    expect(recoverable(s.fields[0])).toBeGreaterThan(r0 * 1.2);
  });
});

describe('actions', () => {
  it('dry run never mutates state', () => {
    const s = rich();
    const before = serialize(s);
    buyTech(s, 'wellPad', true);
    buyFacility(s, 'separator', true);
    expect(serialize(s).replace(/"savedAt":\d+/, '')).toBe(before.replace(/"savedAt":\d+/, ''));
  });

  it('cannot spend money it does not have', () => {
    const s = newGame(3);
    s.cash = 10;
    const r = buyFacility(s, 'separator');
    expect(r.ok).toBe(false);
    expect(s.facilities.separator).toBe(0);
  });
});

describe('exploration', () => {
  it('a successful lead becomes a developable field', () => {
    const s = rich(11);
    buyTech(s, 'wellPad');
    buyTech(s, 'exploration');
    const ex = s.exploration;
    const idx = ex.cells.findIndex((c) => c.lead?.success && c.terrain !== 3);
    expect(idx).toBeGreaterThanOrEqual(0);
    const x = idx % ex.w, y = Math.floor(idx / ex.w);
    expect(surveyBlock(s, 0, 2).ok).toBe(true);
    expect(drillWildcat(s, x, y).ok).toBe(true);
    run(s, 25);
    expect(s.fields.length).toBe(2);
    const f = s.fields[1];
    const est = reserveEstimate(f);
    expect(est.p90).toBeLessThan(est.p50);
    expect(est.p50).toBeLessThan(est.p10);
    expect(developField(s, f.id).ok).toBe(true);
    run(s, 30);
    expect(f.developed).toBe(true);
    expect(s.wells.some((w) => w.fieldId === f.id)).toBe(true);
  });

  it('a dry lead is marked dry', () => {
    const s = rich(11);
    buyTech(s, 'wellPad');
    buyTech(s, 'exploration');
    const ex = s.exploration;
    const idx = ex.cells.findIndex((c, i) => !c.lead && c.terrain !== 3 && Math.abs((i % ex.w) - ex.hubX) > 2);
    drillWildcat(s, idx % ex.w, Math.floor(idx / ex.w));
    run(s, 25);
    expect(ex.cells[idx].drilled).toBe('dry');
  });
});

describe('persistence', () => {
  it('is deterministic for a seed', () => {
    const a = newGame(42), b = newGame(42);
    run(a, 300);
    run(b, 300);
    expect(a.cash).toBe(b.cash);
    expect(a.market.price).toBe(b.market.price);
  });

  it('round-trips through save', () => {
    const s = newGame(5);
    run(s, 30);
    const t = deserialize(serialize(s))!;
    run(s, 30);
    run(t, 30);
    expect(t.cash).toBeCloseTo(s.cash, 6);
  });

  it('migrates v1 saves with plain-text log entries', () => {
    const s = newGame(5);
    const v1 = JSON.parse(serialize(s));
    v1.version = 1;
    v1.log = [{ day: 3, text: 'Barrow-2 is drilled and on production.', kind: 'good' }];
    const t = deserialize(JSON.stringify(v1))!;
    expect(t.version).toBe(SAVE_VERSION);
    expect(t.log[0]).toEqual({ day: 3, kind: 'good', msg: { key: 'log.raw', params: { text: 'Barrow-2 is drilled and on production.' } } });
  });

  it('caps offline progress', () => {
    const s = newGame(5);
    const r = simulateOffline(s, 10 * 24 * 3600)!;
    expect(r.days).toBe(365);
    expect(s.day).toBeCloseTo(365, 6);
  });
});
