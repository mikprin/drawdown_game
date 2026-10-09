// Shelf economics: for every successful shelf lead on a few seeds, install a platform, keep the rig
// drilling, run 1800 days and print the result. Used for tuning layer 2.
// Run: npx rolldown scripts/shelf.ts --file /tmp/s.mjs --platform node && node /tmp/s.mjs [seeds...]
import { buyModule, buyTech, charterTanker, decommission, developField, drillWell, drillWildcat } from '../src/game/actions';
import { newGame } from '../src/game/newGame';
import { platformOfField, rigUser } from '../src/game/platform';
import { fieldWells, recoverable } from '../src/game/reservoir';
import { step } from '../src/game/sim';
import type { GameState } from '../src/game/types';

const TECHS = ['wellPad', 'exploration', 'waterflood', 'offshore', 'esp', 'maintCrew'] as const;

function licensed(seed: number): GameState {
  const s = newGame(seed);
  s.cash = 1e10;
  for (const id of TECHS) buyTech(s, id);
  return s;
}

const seeds = process.argv.slice(2).map(Number);
for (const seed of seeds.length ? seeds : [1, 2, 3, 4, 5, 6, 7, 8]) {
  const ex0 = licensed(seed).shelf!;
  const leads = ex0.cells.map((c, i) => ({ c, i })).filter(({ c }) => c.lead?.success && c.terrain >= 5 && c.terrain <= 7);
  for (const lead of leads) {
    const s = licensed(seed);
    const ex = s.shelf!;
    const cash0 = s.cash;
    drillWildcat(s, lead.i % ex.w, Math.floor(lead.i / ex.w), false, 'shelf');
    for (let i = 0; i < 90; i++) step(s, 0.5);
    const f = s.fields.find((q) => q.offshore)!;
    developField(s, f.id);
    for (let i = 0; i < 140; i++) step(s, 0.5);
    const p = platformOfField(s, f.id)!;
    charterTanker(s, p.id);
    let peak = 0, decomDay = -1;
    const maxWells = recoverable(f) > 8e6 ? 6 : 3;
    for (let d = 0; d < 1800; d++) {
      if (!p.decom && !rigUser(s, f.id) && fieldWells(s, f.id).length < maxWells) {
        if (!drillWell(s, f.id).ok && p.modules.wellbay < 1) buyModule(s, p.id, 'wellbay');
      }
      for (let i = 0; i < 2; i++) step(s, 0.5);
      const pf = s.flows.platforms[p.id];
      if (!pf) break;
      peak = Math.max(peak, pf.oil);
      // Abandon once production has collapsed and the platform runs at a loss.
      if (!p.decom && d > 200 && pf.oil < 0.08 * peak && pf.revenue < pf.costTotal) {
        decommission(s, p.id);
        decomDay = d;
      }
    }
    console.log(
      `seed ${seed} depth ${lead.c.terrain} R ${(recoverable(f) / 1e6).toFixed(1)}M pi ${lead.c.lead!.pi.toFixed(0)} ` +
      `peak ${peak.toFixed(0)} bbl/d np ${(f.np / 1e6).toFixed(1)}M net ${((s.cash - cash0) / 1e6).toFixed(0)}M ` +
      `${decomDay >= 0 ? `decommissioned d${decomDay}` : ''}`,
    );
  }
}
