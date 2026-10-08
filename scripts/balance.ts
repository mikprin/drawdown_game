// Greedy bot that plays layer 1, printing a timeline. Used for tuning pacing.
// Run: npx rolldown scripts/balance.ts --file /tmp/b.mjs --platform node && node /tmp/b.mjs <seed>
import {
  buyFacility, buyTech, convertToInjector, developField, drillWell, drillWildcat, repairWell,
  serviceWell, setLift, surveyBlock,
} from '../src/game/actions';
import { blockCells } from '../src/game/sim';
import { newGame } from '../src/game/newGame';
import { step } from '../src/game/sim';
import { fmtMoney, fmtRate } from '../src/game/format';
import type { GameState } from '../src/game/types';

const seed = Number(process.argv[2] ?? 1);
const s: GameState = newGame(seed);
const events: string[] = [];
const did = (label: string, r: { ok: boolean }) => {
  if (r.ok) events.push(`d${Math.floor(s.day)} ${label}`);
  return r.ok;
};

function bot(): void {
  for (const w of s.wells) {
    if (w.status === 'failed' && !w.job && did(`repair ${w.name}`, repairWell(s, w.id))) return;
    if (w.condition < 0.45 && w.status === 'active' && !w.job) serviceWell(s, w.id);
  }
  const fl = s.flows;
  if (fl.bottleneck === 'storage' && did('truck', buyFacility(s, 'trucks'))) return;
  if (fl.bottleneck === 'separator' && did('separator', buyFacility(s, 'separator'))) return;
  if (fl.bottleneck === 'water') {
    if (s.facilities.swd < 1 && fl.water > 500 ? did('swd', buyFacility(s, 'swd')) : did('wtruck', buyFacility(s, 'waterTrucks'))) return;
  }
  if (!s.techs.wellPad) { did('wellPad', buyTech(s, 'wellPad')); return; }
  const home = s.fields[0];
  if (s.wells.filter((w) => w.fieldId === 1).length < 3) { did('drill home', drillWell(s, 1)); return; }
  if (!s.techs.waterflood) { did('waterflood', buyTech(s, 'waterflood')); return; }
  if (s.facilities.injection < 1) { did('injection', buyFacility(s, 'injection')); return; }
  if (!s.wells.some((w) => w.status === 'injector') && s.wells.filter((w) => w.fieldId === 1).length < 4) { did('drill home', drillWell(s, 1)); return; }
  if (!s.wells.some((w) => w.status === 'injector' || w.job?.kind === 'convert')) {
    const worst = s.wells.filter((w) => w.fieldId === 1 && w.status === 'active' && !w.job).sort((a, b) => b.wcBias - a.wcBias)[0];
    if (worst) { did('convert', convertToInjector(s, worst.id)); return; }
  }
  void home;
  for (const f of s.fields) {
    if (f.id !== 1 && f.developed && f.slots > s.wells.filter((w) => w.fieldId === f.id).length) {
      if (did(`drill ${f.name}`, drillWell(s, f.id))) return; else return;
    }
  }
  for (const f of s.fields) if (!f.developed && !f.devJob) { if (did(`develop ${f.name}`, developField(s, f.id))) return; else return; }
  if (!s.techs.exploration) { did('exploration', buyTech(s, 'exploration')); return; }
  const ex = s.exploration;
  if (!ex.wildcat) {
    let best = -1, bestCos = 0.22;
    ex.cells.forEach((c, i) => {
      const bw = ex.w / 4;
      const blk = Math.floor(Math.floor(i / ex.w) / 4) * bw + Math.floor((i % ex.w) / 4);
      if (c.lead && c.drilled === 'none' && ex.blocks[blk] >= 2 && c.lead.detect2d) {
        const est = c.lead.cos + c.lead.noise2d * 0.18;
        if (est > bestCos) { bestCos = est; best = i; }
      }
    });
    if (best >= 0) { did(`wildcat cos~${bestCos.toFixed(2)}${ex.cells[best].lead!.success ? '+' : '-'}`, drillWildcat(s, best % ex.w, Math.floor(best / ex.w))); return; }
  }
  if (!ex.surveys.length) {
    // A player sees the faint regional hint; the bot cheats with the true prior.
    const order = ex.blocks.map((_, b) => b).filter((b) => ex.blocks[b] === 0)
      .sort((a, b) => avgPrior(b) - avgPrior(a));
    if (order.length) { did(`survey ${order[0]}`, surveyBlock(s, order[0], 2)); return; }
  }
  if (!s.techs.maintCrew && s.wells.length >= 6) { did('maintCrew', buyTech(s, 'maintCrew')); return; }
  for (const w of s.wells) {
    const wf = s.flows.wells[w.id];
    if (w.status === 'active' && !w.job && wf && wf.reservoir > wf.liftCap * 1.3 && w.lift === 'flowing' && wf.liftCap < 250) {
      did(`rodpump ${w.name}`, setLift(s, w.id, 'rodpump')); return;
    }
  }
}

function avgPrior(b: number): number {
  const cells = blockCells(s, b);
  return cells.reduce((a, c) => a + c.prior, 0) / cells.length;
}

const until = Number(process.argv[3] ?? 3000);
for (let d = 0; d <= until; d += 0.5) {
  step(s, 0.5);
  if (d % 1 === 0) bot();
  if (d % 150 === 0) {
    const fl = s.flows;
    console.log(
      `day ${d.toString().padStart(4)} cash ${fmtMoney(s.cash).padStart(8)} oil ${fmtRate(fl.oil).padStart(12)} ` +
      `wc ${((fl.water / Math.max(1, fl.liquid)) * 100).toFixed(0).padStart(3)}% profit/d ${fmtMoney(fl.profit).padStart(7)} ` +
      `price $${s.market.price.toFixed(0)} wells ${s.wells.length} fields ${s.fields.filter((f) => f.developed).length} ` +
      `bn ${fl.bottleneck} produced ${(s.stats.oilProduced / 1e6).toFixed(2)}M`,
    );
  }
}
console.log(events.filter((e) => !/truck|service/.test(e)).join(' | '));
