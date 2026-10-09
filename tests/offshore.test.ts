import { describe, expect, it } from 'vitest';
import {
  buildTerminal, buyModule, buyTech, charterTanker, decommission, developField, drillWell, drillWildcat, expandDeck, setLift,
  setSellMode, surveyBlock, upgradeTerminal,
} from '../src/game/actions';
import { OFFSHORE, TERMINAL } from '../src/game/balance';
import { newGame, SAVE_VERSION } from '../src/game/newGame';
import { deckArea, deckUsed, legDays, platformOfField } from '../src/game/platform';
import { fieldWells } from '../src/game/reservoir';
import { deserialize, serialize } from '../src/game/save';
import { step } from '../src/game/sim';
import type { Field, GameState } from '../src/game/types';

function run(s: GameState, days: number, dt = 0.5) {
  for (let t = 0; t < days; t += dt) step(s, dt);
}

function licensed(seed = 7): GameState {
  const s = newGame(seed);
  s.cash = 1e10;
  for (const id of ['wellPad', 'exploration', 'waterflood', 'offshore'] as const) expect(buyTech(s, id).ok).toBe(true);
  return s;
}

/** Drill a guaranteed discovery on the shelf and return the new field. */
function discover(s: GameState): Field {
  const ex = s.shelf!;
  const idx = ex.cells.findIndex((c, i) => c.terrain >= 5 && c.terrain <= 7 && Math.abs((i % ex.w) - ex.hubX) > 2);
  const cell = ex.cells[idx];
  cell.lead = {
    cos: 0.5, success: true, ooip: 40_000_000, rfBase: 0.25, pi: 2000, gor: 900,
    detect2d: true, noise2d: 0, noise3d: 0, sizeBias: 0, costMult: 1.2,
  };
  expect(drillWildcat(s, idx % ex.w, Math.floor(idx / ex.w), false, 'shelf').ok).toBe(true);
  run(s, 45);
  const f = s.fields.find((x) => x.offshore)!;
  expect(f).toBeDefined();
  return f;
}

function onStream(s: GameState): Field {
  const f = discover(s);
  expect(developField(s, f.id).ok).toBe(true);
  run(s, OFFSHORE.installDays + 20);
  expect(f.developed).toBe(true);
  return f;
}

describe('shelf', () => {
  it('the license creates the shelf map; land cells cannot be drilled', () => {
    const s = licensed();
    expect(s.shelf).not.toBeNull();
    const ex = s.shelf!;
    const land = ex.cells.findIndex((c) => c.terrain === 4);
    expect(drillWildcat(s, land % ex.w, Math.floor(land / ex.w), true, 'shelf').ok).toBe(false);
    expect(surveyBlock(s, 5, 2, false, 'shelf').ok).toBe(true);
    run(s, 25);
    expect(ex.blocks[5]).toBe(2);
  });

  it('a platform produces and tankers sell cargoes', () => {
    const s = licensed();
    const f = onStream(s);
    const p = platformOfField(s, f.id)!;
    expect(fieldWells(s, f.id).length).toBe(1);
    expect(p.tankers.length).toBe(1);
    const cash0 = s.cash;
    for (let i = 0; i < 600; i++) {
      step(s, 0.5);
      const pf = s.flows.platforms[p.id];
      expect(pf.liquid).toBeLessThanOrEqual(pf.sepCap + 1e-6);
      expect(pf.water).toBeLessThanOrEqual(pf.waterCap + 1e-6);
      expect(p.storage).toBeLessThanOrEqual(pf.storageCap + 1e-6);
      for (const t of p.tankers) expect(t.cargo).toBeLessThanOrEqual(OFFSHORE.tankerCargo + 1e-6);
    }
    expect(s.stats.cargoes).toBeGreaterThan(0);
    expect(s.cash).toBeGreaterThan(cash0);
    expect(s.flows.total.oil).toBeGreaterThan(s.flows.oil);
  });

  it('one rig per platform: wells are drilled one at a time, no pumpjacks', () => {
    const s = licensed();
    const f = onStream(s);
    const p = platformOfField(s, f.id)!;
    expect(drillWell(s, f.id).ok).toBe(true);
    const second = drillWell(s, f.id, true);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason.key).toBe('reason.rigOn');
    const w = fieldWells(s, f.id)[0];
    expect(setLift(s, w.id, 'rodpump', true).ok).toBe(false);
    run(s, OFFSHORE.drillDays + 15);
    expect(drillWell(s, f.id).ok).toBe(true);
    run(s, OFFSHORE.drillDays + 15);
    expect(drillWell(s, f.id, true).ok).toBe(false); // three slots on a new well bay
    expect(buyModule(s, p.id, 'wellbay').ok).toBe(true);
    expect(f.slots).toBe(6);
  });

  it('modules share the deck; extending it makes room', () => {
    const s = licensed();
    const f = onStream(s);
    const p = platformOfField(s, f.id)!;
    const buys = ['separator', 'separator', 'storage', 'storage', 'turbine'] as const;
    let refused = false;
    for (const id of buys) {
      const r = buyModule(s, p.id, id);
      if (!r.ok) {
        expect(r.reason.key).toBe('reason.deckFull');
        refused = true;
        break;
      }
    }
    expect(refused).toBe(true);
    expect(deckUsed(p)).toBeLessThanOrEqual(deckArea(p));
    expect(expandDeck(s, p.id).ok).toBe(true);
    expect(buyModule(s, p.id, 'turbine').ok).toBe(true);
    expect(deckUsed(p)).toBeLessThanOrEqual(deckArea(p));
  });

  it('turbines burn gas instead of diesel', () => {
    const s = licensed();
    const f = onStream(s);
    const p = platformOfField(s, f.id)!;
    run(s, 2);
    const diesel0 = s.flows.platforms[p.id].costs.diesel!;
    expect(expandDeck(s, p.id).ok).toBe(true);
    expect(buyModule(s, p.id, 'turbine').ok).toBe(true);
    run(s, 2);
    const pf = s.flows.platforms[p.id];
    expect(pf.gasFuel).toBeGreaterThan(0);
    expect(pf.costs.diesel!).toBeLessThan(diesel0);
  });

  it('storms stop loading; Hold keeps the cargo in port', () => {
    const s = licensed();
    const f = onStream(s);
    const p = platformOfField(s, f.id)!;
    charterTanker(s, p.id);
    s.weather.next = 1;
    run(s, 2);
    expect(s.weather.storm).toBeGreaterThan(0);
    const moored = p.tankers.find((t) => t.state === 'moored');
    const cargo = moored?.cargo ?? 0;
    step(s, 0.5);
    expect(s.flows.platforms[p.id].loaded).toBe(0);
    if (moored) expect(moored.cargo).toBe(cargo);

    run(s, 20);
    setSellMode(s, 'hold');
    const sold = s.stats.cargoes;
    run(s, 120);
    expect(s.stats.cargoes).toBe(sold);
    expect(p.tankers.some((t) => t.state === 'port')).toBe(true);
  });

  it('decommissioning removes the wells and frees the slot', () => {
    const s = licensed();
    const f = onStream(s);
    const p = platformOfField(s, f.id)!;
    expect(decommission(s, p.id).ok).toBe(true);
    expect(fieldWells(s, f.id).length).toBe(0);
    expect(f.abandoned).toBe(true);
    expect(developField(s, f.id, true).ok).toBe(false);
    run(s, OFFSHORE.decomDays + 20);
    expect(s.platforms.length).toBe(0);
  });

  it('caps the number of platforms', () => {
    const s = licensed();
    const f = discover(s);
    for (let i = 0; i < OFFSHORE.maxPlatforms; i++) {
      s.platforms.push({ id: 900 + i, fieldId: f.id, deck: 0, modules: { wellbay: 0, separator: 0, storage: 0, waterTreat: 0, injection: 0, turbine: 0, gasInj: 0 }, storage: 0, tankers: [], revenueEma: 0, decom: { daysLeft: 1e9, total: 1e9 } });
    }
    const r = developField(s, f.id, true);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.key).toBe('reason.maxPlatforms');
  });
});

describe('coastal terminal', () => {
  it('needs the shelf license; builds with tanks and a jetty, both upgradable', () => {
    const s = newGame(7);
    s.cash = 1e10;
    expect(buildTerminal(s, true).ok).toBe(false);
    for (const id of ['wellPad', 'exploration', 'waterflood', 'offshore'] as const) buyTech(s, id);
    expect(upgradeTerminal(s, 'tanks', true).ok).toBe(false);
    const cash0 = s.cash;
    expect(buildTerminal(s).ok).toBe(true);
    expect(cash0 - s.cash).toBe(TERMINAL.buildCost);
    expect(s.terminal).toEqual({ tanks: 1, jetty: 1, storage: 0 });
    expect(buildTerminal(s, true).ok).toBe(false);
    expect(upgradeTerminal(s, 'tanks').ok).toBe(true);
    expect(upgradeTerminal(s, 'jetty').ok).toBe(true);
    expect(upgradeTerminal(s, 'jetty').ok).toBe(true);
    expect(upgradeTerminal(s, 'jetty', true).ok).toBe(false);
  });

  it('tankers discharge at the terminal on a shorter voyage, and the terminal sells', () => {
    const s = licensed();
    const f = onStream(s);
    const p = platformOfField(s, f.id)!;
    buildTerminal(s);
    expect(legDays(s, p, 'terminal')).toBeLessThan(legDays(s, p, 'port'));
    const sold0 = s.stats.oilSold;
    run(s, 200);
    expect(p.tankers.some((t) => t.dest === 'terminal')).toBe(true);
    expect(s.stats.cargoes).toBeGreaterThan(0);
    expect(s.stats.oilSold).toBeGreaterThan(sold0);
    expect(s.flows.terminal).not.toBeNull();
    expect(s.terminal!.storage).toBeLessThanOrEqual(s.flows.terminal!.storageCap + 1e-6);
  });

  it('under Hold the terminal stores instead of tankers idling; a full terminal makes them wait', () => {
    const s = licensed();
    const f = onStream(s);
    const p = platformOfField(s, f.id)!;
    buildTerminal(s);
    setSellMode(s, 'hold');
    run(s, 150);
    expect(s.terminal!.storage).toBeGreaterThan(0);
    expect(s.flows.terminal!.sold).toBe(0);
    expect(p.tankers.some((t) => t.state === 'port' && t.dest !== 'terminal')).toBe(false);

    s.terminal!.storage = TERMINAL.tanks[1].value;
    run(s, 60);
    expect(s.flows.terminal!.waiting).toBeGreaterThan(0);
    setSellMode(s, 'auto');
    const sold0 = s.stats.oilSold;
    run(s, 30);
    expect(s.stats.oilSold - sold0).toBeGreaterThan(TERMINAL.tanks[1].value * 0.5);
    expect(s.flows.terminal!.waiting).toBe(0);
  });
});

describe('shelf persistence', () => {
  it('migrates v3 saves: no terminal, tankers bound for the port', () => {
    const s = licensed();
    onStream(s);
    const v3 = JSON.parse(serialize(s));
    v3.version = 3;
    delete v3.terminal;
    for (const p of v3.platforms) for (const t of p.tankers) delete t.dest;
    const t = deserialize(JSON.stringify(v3))!;
    expect(t.version).toBe(SAVE_VERSION);
    expect(t.terminal).toBeNull();
    run(t, 120);
    expect(t.stats.cargoes).toBeGreaterThan(0);
  });

  it('migrates v2 saves: no shelf, no platforms', () => {
    const s = newGame(5);
    const v2 = JSON.parse(serialize(s));
    v2.version = 2;
    delete v2.shelf;
    delete v2.platforms;
    delete v2.weather;
    delete v2.stats.cargoes;
    const t = deserialize(JSON.stringify(v2))!;
    expect(t.version).toBe(SAVE_VERSION);
    expect(t.shelf).toBeNull();
    expect(t.platforms).toEqual([]);
    run(t, 10);
    expect(t.stats.cargoes).toBe(0);
  });

  it('a running platform round-trips through save', () => {
    const s = licensed();
    onStream(s);
    const t = deserialize(serialize(s))!;
    run(s, 60);
    run(t, 60);
    expect(t.cash).toBeCloseTo(s.cash, 3);
    expect(t.stats.cargoes).toBe(s.stats.cargoes);
  });
});
