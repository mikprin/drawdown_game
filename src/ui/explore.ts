import { buyTech, developCost, developField, drillWildcat, surveyBlock } from '../game/actions';
import { EXPLORATION } from '../game/balance';
import {
  blockOf, cellAt, cosEstimate, heatEstimate, isDrillable, leadSizeEstimate, surveyLevel, TERRAIN_NAMES,
} from '../game/explore';
import { fmtBbl, fmtDays, fmtMoney, fmtNum, fmtPct } from '../game/format';
import { reserveEstimate } from '../game/reservoir';
import type { GameState } from '../game/types';
import { ActionButton, bar, h, setBar, setText } from './dom';
import type { Ctx } from './ctx';

const SURVEY_NAMES = ['Unsurveyed', '', '2D seismic', '3D seismic'];

export class ExplorePanel {
  readonly el = h('div');
  private license: HTMLElement;
  private licenseBtn: ActionButton;
  private cellBox = h('div');
  private cellKey = '';
  private cellUpdate: (() => void) | null = null;
  private ops = h('div');
  private opsKey = '';
  private opsUpdate: (() => void) | null = null;
  private finds = h('div');
  private findsKey = '';

  constructor(private ctx: Ctx) {
    this.licenseBtn = new ActionButton('Buy exploration license', () => buyTech(ctx.s, 'exploration', true), () => ctx.act((s) => buyTech(s, 'exploration')), { cls: 'primary block' });
    this.license = h('div', { class: 'section' },
      h('div', { class: 'card rivets' },
        h('div', { class: 'title-row' }, h('span', { class: 'name' }, 'No license')),
        h('p', { class: 'muted' }, 'The regional map is fogged. A license lets you shoot seismic and drill wildcats. Every dry hole costs real money; every discovery can change the company.'),
        this.licenseBtn.el));
    this.el.append(
      this.license,
      h('div', { class: 'section' }, h('div', { class: 'section-title' }, 'Selected cell'), this.cellBox),
      h('div', { class: 'section' }, h('div', { class: 'section-title' }, 'Operations'), this.ops),
      h('div', { class: 'section' }, h('div', { class: 'section-title' }, 'Discoveries'), this.finds),
      h('div', { class: 'section' }, h('div', { class: 'section-title' }, 'Legend'), legend()),
    );
  }

  update(): void {
    const s = this.ctx.s;
    this.license.style.display = s.techs.exploration ? 'none' : '';
    this.licenseBtn.update();
    this.updateCell(s);
    this.updateOps(s);
    this.updateFinds(s);
  }

  private updateCell(s: GameState): void {
    const sel = this.ctx.ui.cell;
    const ctx = this.ctx;
    if (!sel) {
      if (this.cellKey !== 'none') {
        this.cellKey = 'none';
        this.cellUpdate = null;
        this.cellBox.replaceChildren(h('div', { class: 'empty' }, 'Click a cell on the map. Survey blocks (4×4) to lift the fog, then drill the most promising leads.'));
      }
      return;
    }
    const { x, y } = sel;
    const c = cellAt(s, x, y);
    const key = `${x},${y}|${surveyLevel(s, x, y)}|${c.drilled}|${c.fieldId}|${s.fields.find((f) => f.id === c.fieldId)?.developed}|${s.techs.exploration}|${s.techs.seismic3d}`;
    if (key !== this.cellKey) {
      this.cellKey = key;
      const blk = blockOf(s, x, y);
      const lvl = surveyLevel(s, x, y);
      const btns: ActionButton[] = [];
      let devUpdate: (() => void) | null = null;
      const kv: Node[] = [];
      const row = (k: string, v: string, cls = '') => kv.push(h('span', { class: 'k' }, k), h('span', { class: `v ${cls}` }, v));
      row('Terrain', TERRAIN_NAMES[c.terrain]);
      row(`Block B${blk + 1}`, SURVEY_NAMES[lvl]);
      const heat = heatEstimate(s, x, y);
      if (heat !== null) row('Geological chance', fmtPct(heat));
      const cos = cosEstimate(s, x, y);
      if (cos !== null) row('Chance of success', `${fmtPct(cos)} ±${lvl === 3 ? 6 : 18}`, 'amber');
      else if (lvl > 0 && c.drilled === 'none') row('Lead', lvl === 3 ? 'none mapped' : 'none seen (2D may miss)', 'faint');
      const size = leadSizeEstimate(s, x, y);
      if (size) row('Size P90 / P50 / P10', `${fmtNum(size.p90)} / ${fmtNum(size.p50)} / ${fmtNum(size.p10)}`);
      if (c.drilled === 'dry') row('Result', 'Dry hole', 'bad');

      const field = c.fieldId > 0 ? s.fields.find((f) => f.id === c.fieldId) : undefined;
      const body: (Node | null)[] = [
        h('div', { class: 'title-row' }, h('span', { class: 'name' }, field ? field.name : `Cell ${x},${y}`),
          field ? h('span', { class: `badge right ${field.developed ? 'good' : 'amber'}` }, field.developed ? 'producing' : field.devJob ? 'building' : 'discovery') : null),
        h('div', { class: 'kv' }, ...kv),
      ];

      if (field && !field.developed) {
        const est = reserveEstimate(field);
        body.push(h('div', { class: 'reserve' },
          h('div', null, h('div', { class: 'k' }, 'P90'), h('div', { class: 'v' }, fmtNum(est.p90))),
          h('div', { class: 'p50' }, h('div', { class: 'k' }, 'P50 EUR'), h('div', { class: 'v' }, fmtNum(est.p50))),
          h('div', null, h('div', { class: 'k' }, 'P10'), h('div', { class: 'v' }, fmtNum(est.p10)))));
        body.push(h('div', { class: 'kv' },
          h('span', { class: 'k' }, 'Well cost multiplier'), h('span', { class: 'v' }, `×${field.costMult.toFixed(2)}`),
          h('span', { class: 'k' }, 'Gas-oil ratio'), h('span', { class: 'v' }, `${field.gor.toFixed(0)} scf/bbl`)));
        if (field.devJob) {
          const pb = bar('tall');
          const lbl = h('span');
          body.push(h('div', { class: 'progress' }, h('div', { class: 'lbl' }, h('span', null, 'Building pad & flowline'), lbl), pb));
          devUpdate = () => {
            if (!field.devJob) return;
            setText(lbl, fmtDays(field.devJob.daysLeft));
            setBar(pb, 1 - field.devJob.daysLeft / field.devJob.total);
          };
        } else {
          const b = new ActionButton(`Develop · ${EXPLORATION.developDays}d`, () => developField(ctx.s, field.id, true), () => ctx.act((st) => developField(st, field.id)), { cls: 'primary block', hint: `Pad + flowline to the hub: ${fmtMoney(developCost(s, field.id))}` });
          btns.push(b);
          body.push(h('div', { class: 'btn-row' }, b.el));
        }
      }

      const sv2 = new ActionButton(`2D seismic · ${EXPLORATION.survey2dDays}d`, () => surveyBlock(ctx.s, blk, 2, true), () => ctx.act((st) => surveyBlock(st, blk, 2)), { cls: 'small', hint: 'Coarse chance map for the 4×4 block. Detects ~70% of leads.' });
      const sv3 = new ActionButton(`3D seismic · ${EXPLORATION.survey3dDays}d`, () => surveyBlock(ctx.s, blk, 3, true), () => ctx.act((st) => surveyBlock(st, blk, 3)), { cls: 'small', hint: 'Sharp chance estimate, all leads, and size estimates.' });
      btns.push(sv2, sv3);
      body.push(h('div', { class: 'btn-grid' }, sv2.el, sv3.el));
      if (isDrillable(s, x, y)) {
        const wc = new ActionButton(`Drill wildcat · ${EXPLORATION.wildcatDays}d`, () => drillWildcat(ctx.s, x, y, true), () => ctx.act((st) => drillWildcat(st, x, y)), { cls: 'primary block', hint: c.lead ? undefined : 'No mapped lead here — a blind bet.' });
        btns.push(wc);
        body.push(h('div', { class: 'btn-row' }, wc.el));
      }
      this.cellBox.replaceChildren(h('div', { class: 'card rivets' }, ...body));
      this.cellUpdate = () => {
        devUpdate?.();
        for (const b of btns) b.update();
      };
    }
    this.cellUpdate?.();
  }

  private updateOps(s: GameState): void {
    const ex = s.exploration;
    const key = `${ex.wildcat ? `${ex.wildcat.x},${ex.wildcat.y}` : '-'}|${ex.surveys.map((v) => v.block + ':' + v.kind).join(',')}`;
    if (key !== this.opsKey) {
      this.opsKey = key;
      const items: { lbl: HTMLElement; bar: HTMLElement; get: () => [number, number] }[] = [];
      const rows: Node[] = [];
      const add = (title: string, get: () => [number, number]) => {
        const lbl = h('span');
        const b = bar('tall');
        items.push({ lbl, bar: b, get });
        rows.push(h('div', { class: 'progress' }, h('div', { class: 'lbl' }, h('span', null, title), lbl), b));
      };
      if (ex.wildcat) {
        const w = ex.wildcat;
        add(`Rig: wildcat at ${w.x},${w.y}`, () => [ex.wildcat?.daysLeft ?? 0, w.total]);
      }
      for (const sv of ex.surveys) add(`${sv.kind}D crew: block B${sv.block + 1}`, () => [sv.daysLeft, sv.total]);
      this.ops.replaceChildren(...(rows.length ? rows : [h('div', { class: 'empty' }, 'Rig idle. No survey crews in the field.')]));
      this.opsUpdate = () => {
        for (const it of items) {
          const [left, total] = it.get();
          setText(it.lbl, fmtDays(left));
          setBar(it.bar, 1 - left / total);
        }
      };
    }
    this.opsUpdate?.();
  }

  private updateFinds(s: GameState): void {
    const found = s.fields.filter((f) => f.id !== 1);
    const key = found.map((f) => `${f.id}:${f.developed}:${!!f.devJob}`).join(',');
    if (key !== this.findsKey) {
      this.findsKey = key;
      const rows = found.map((f) => {
        const est = reserveEstimate(f);
        const sel = h('button', { class: 'btn small ghost', onclick: () => this.ctx.selectCell(f.cellX, f.cellY) }, 'Show');
        return h('div', { class: 'tech' },
          h('span', { class: 'nm' }, f.name),
          sel,
          h('div', { class: 'desc' }, `${f.developed ? 'Producing' : f.devJob ? 'Under construction' : 'Awaiting development'} · P50 ${fmtBbl(est.p50)}`));
      });
      this.finds.replaceChildren(...(rows.length ? rows : [h('div', { class: 'empty' }, 'Nothing yet. The basin is out there.')]));
    }
  }
}

function legend(): HTMLElement {
  const sw = (color: string) => h('i', { style: `display:inline-block;width:12px;height:12px;background:${color};margin-right:6px;vertical-align:middle;border-radius:2px` });
  return h('div', { class: 'kv', style: 'grid-template-columns:auto 1fr' },
    sw('#6f8a52'), h('span', { class: 'muted' }, 'Low geological chance'),
    sw('#c9a640'), h('span', { class: 'muted' }, 'Fair'),
    sw('#e0782e'), h('span', { class: 'muted' }, 'Good'),
    sw('#e8452a'), h('span', { class: 'muted' }, 'Excellent'),
    h('span', null, '◎'), h('span', { class: 'muted' }, 'Lead with estimated chance of success'),
    h('span', null, '✕'), h('span', { class: 'muted' }, 'Dry hole'),
  );
}

export function cellTooltip(s: GameState, x: number, y: number): string {
  const c = cellAt(s, x, y);
  const lvl = surveyLevel(s, x, y);
  const lines = [`<b>Cell ${x},${y}</b> · ${TERRAIN_NAMES[c.terrain]}`, `<span class="muted">${SURVEY_NAMES[lvl]}</span>`];
  const heat = heatEstimate(s, x, y);
  if (heat !== null) lines.push(`Geological chance ${fmtPct(heat)}`);
  const cos = cosEstimate(s, x, y);
  if (cos !== null) lines.push(`<span class="amber">Lead: ${fmtPct(cos)} chance</span>`);
  const size = leadSizeEstimate(s, x, y);
  if (size) lines.push(`P50 ~${fmtBbl(size.p50)}`);
  if (c.drilled === 'dry') lines.push('<span class="bad">Dry hole</span>');
  if (c.fieldId > 0) lines.push(`<span class="good">${s.fields.find((f) => f.id === c.fieldId)?.name}</span>`);
  return lines.join('<br>');
}
