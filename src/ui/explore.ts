import { buyTech, developCost, developField, drillWildcat, surveyBlock } from '../game/actions';
import { EXPLORATION } from '../game/balance';
import {
  blockOf, cellAt, cosEstimate, heatEstimate, isDrillable, leadSizeEstimate, surveyLevel,
} from '../game/explore';
import { fmtBbl, fmtDays, fmtGor, fmtNum, fmtPct } from '../game/format';
import { reserveEstimate } from '../game/reservoir';
import type { GameState } from '../game/types';
import { t, type HelpId, type MsgKey } from '../i18n';
import { ActionButton, bar, h, setBar, setText } from './dom';
import type { Ctx } from './ctx';
import { help, term } from './help';

const TERRAIN: MsgKey[] = ['terrain.plain', 'terrain.hills', 'terrain.marsh', 'terrain.lake'];
const SURVEY: MsgKey[] = ['survey.none', 'survey.none', 'survey.2d', 'survey.3d'];

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
    this.licenseBtn = new ActionButton(t('ex.buyLicense'), () => buyTech(ctx.s, 'exploration', true), () => ctx.act((s) => buyTech(s, 'exploration')),
      { cls: 'primary block', help: () => ({ title: t('tech.exploration.name'), body: t('tech.exploration.desc') }) });
    this.license = h('div', { class: 'section' },
      h('div', { class: 'card rivets' },
        h('div', { class: 'title-row' }, h('span', { class: 'name' }, t('ex.noLicense'))),
        h('p', { class: 'muted' }, t('ex.noLicenseText')),
        this.licenseBtn.el));
    this.el.append(
      this.license,
      h('div', { class: 'section' }, h('div', { class: 'section-title' }, t('ex.cell')), this.cellBox),
      h('div', { class: 'section' }, h('div', { class: 'section-title' }, t('ex.ops')), this.ops),
      h('div', { class: 'section' }, h('div', { class: 'section-title' }, t('ex.finds')), this.finds),
      h('div', { class: 'section' }, h('div', { class: 'section-title' }, t('ex.legend')), legend()),
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
        this.cellBox.replaceChildren(h('div', { class: 'empty' }, t('ex.clickCell')));
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
      const row = (k: string, v: string, cls = '', id?: HelpId) => {
        const label = h('span', { class: 'k' }, k);
        kv.push(id ? help(label, id) : label, h('span', { class: `v ${cls}` }, v));
      };
      row(t('ex.terrain'), t(TERRAIN[c.terrain]), '', 'terrain');
      row(t('ex.block', { n: blk + 1 }), t(SURVEY[lvl]), '', 'survey');
      const heat = heatEstimate(s, x, y);
      if (heat !== null) row(t('ex.geoChance'), fmtPct(heat), '', 'geoChance');
      const cos = cosEstimate(s, x, y);
      if (cos !== null) row(t('ex.cos'), t('ex.cosVal', { p: cos, e: lvl === 3 ? 6 : 18 }), 'amber', 'cos');
      else if (lvl > 0 && c.drilled === 'none') row(t('ex.lead'), t(lvl === 3 ? 'ex.noneMapped' : 'ex.noneSeen'), 'faint', 'lead');
      const size = leadSizeEstimate(s, x, y);
      if (size) row(t('ex.size'), `${fmtNum(size.p90)} / ${fmtNum(size.p50)} / ${fmtNum(size.p10)}`, '', 'eur');
      if (c.drilled === 'dry') row(t('ex.result'), t('ex.dryHole'), 'bad');

      const field = c.fieldId > 0 ? s.fields.find((f) => f.id === c.fieldId) : undefined;
      const body: (Node | null)[] = [
        h('div', { class: 'title-row' }, h('span', { class: 'name' }, field ? field.name : t('ex.cellName', { x, y })),
          field ? h('span', { class: `badge right ${field.developed ? 'good' : 'amber'}` },
            t(field.developed ? 'ex.producing' : field.devJob ? 'ex.building' : 'ex.discovery')) : null),
        h('div', { class: 'kv' }, ...kv),
      ];

      if (field && !field.developed) {
        const est = reserveEstimate(field);
        body.push(help(h('div', { class: 'reserve' },
          h('div', null, h('div', { class: 'k' }, t('ops.p90')), h('div', { class: 'v' }, fmtNum(est.p90))),
          h('div', { class: 'p50' }, h('div', { class: 'k' }, t('ops.p50')), h('div', { class: 'v' }, fmtNum(est.p50))),
          h('div', null, h('div', { class: 'k' }, t('ops.p10')), h('div', { class: 'v' }, fmtNum(est.p10)))), 'eur', false));
        body.push(h('div', { class: 'kv' },
          help(h('span', { class: 'k' }, t('ex.costMult')), 'costMult'), h('span', { class: 'v' }, `×${field.costMult.toFixed(2)}`),
          help(h('span', { class: 'k' }, t('ex.gor')), 'gor'), h('span', { class: 'v' }, fmtGor(field.gor))));
        if (field.devJob) {
          const pb = bar('tall');
          const lbl = h('span');
          body.push(h('div', { class: 'progress' }, h('div', { class: 'lbl' }, h('span', null, t('ex.buildingPad')), lbl), pb));
          devUpdate = () => {
            if (!field.devJob) return;
            setText(lbl, fmtDays(field.devJob.daysLeft));
            setBar(pb, 1 - field.devJob.daysLeft / field.devJob.total);
          };
        } else {
          const b = new ActionButton(t('ex.develop', { days: EXPLORATION.developDays }), () => developField(ctx.s, field.id, true), () => ctx.act((st) => developField(st, field.id)),
            { cls: 'primary block', help: () => ({ ...term('develop'), body: `${t('help.develop.b')} ${t('ex.developCost', { cost: developCost(ctx.s, field.id) })}` }) });
          btns.push(b);
          body.push(h('div', { class: 'btn-row' }, b.el));
        }
      }

      const surveyHelp = (title: MsgKey, hint: MsgKey) => () => ({ title: t(title), body: t(hint) });
      const sv2 = new ActionButton(t('ex.sv2', { days: EXPLORATION.survey2dDays }), () => surveyBlock(ctx.s, blk, 2, true), () => ctx.act((st) => surveyBlock(st, blk, 2)),
        { cls: 'small', help: surveyHelp('survey.2d', 'ex.sv2Hint') });
      const sv3 = new ActionButton(t('ex.sv3', { days: EXPLORATION.survey3dDays }), () => surveyBlock(ctx.s, blk, 3, true), () => ctx.act((st) => surveyBlock(st, blk, 3)),
        { cls: 'small', help: surveyHelp('survey.3d', 'ex.sv3Hint') });
      btns.push(sv2, sv3);
      body.push(h('div', { class: 'btn-grid' }, sv2.el, sv3.el));
      if (isDrillable(s, x, y)) {
        const wc = new ActionButton(t('ex.wildcat', { days: EXPLORATION.wildcatDays }), () => drillWildcat(ctx.s, x, y, true), () => ctx.act((st) => drillWildcat(st, x, y)),
          { cls: 'primary block', help: () => ({ ...term('wildcat'), note: c.lead ? undefined : t('ex.blind'), noteCls: 'amber' }) });
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
        add(t('ex.rigAt', { x: w.x, y: w.y }), () => [ex.wildcat?.daysLeft ?? 0, w.total]);
      }
      for (const sv of ex.surveys) add(t('ex.crew', { kind: sv.kind, n: sv.block + 1 }), () => [sv.daysLeft, sv.total]);
      this.ops.replaceChildren(...(rows.length ? rows : [h('div', { class: 'empty' }, t('ex.idle'))]));
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
        const sel = h('button', { class: 'btn small ghost', onclick: () => this.ctx.selectCell(f.cellX, f.cellY) }, t('ex.show'));
        const state = t(f.developed ? 'ex.fProducing' : f.devJob ? 'ex.fBuilding' : 'ex.fAwaiting');
        return h('div', { class: 'tech' },
          h('span', { class: 'nm' }, f.name),
          sel,
          h('div', { class: 'desc' }, `${state} · P50 ${fmtBbl(est.p50)}`));
      });
      this.finds.replaceChildren(...(rows.length ? rows : [h('div', { class: 'empty' }, t('ex.nothing'))]));
    }
  }
}

function legend(): HTMLElement {
  const sw = (color: string) => h('i', { style: `display:inline-block;width:12px;height:12px;background:${color};margin-right:6px;vertical-align:middle;border-radius:2px` });
  return h('div', { class: 'kv', style: 'grid-template-columns:auto 1fr' },
    sw('#6f8a52'), help(h('span', { class: 'muted' }, t('ex.lgLow')), 'geoChance'),
    sw('#c9a640'), h('span', { class: 'muted' }, t('ex.lgFair')),
    sw('#e0782e'), h('span', { class: 'muted' }, t('ex.lgGood')),
    sw('#e8452a'), h('span', { class: 'muted' }, t('ex.lgExc')),
    h('span', null, '◎'), help(h('span', { class: 'muted' }, t('ex.lgLead')), 'lead'),
    h('span', null, '✕'), h('span', { class: 'muted' }, t('ex.lgDry')),
  );
}

export function cellTooltip(s: GameState, x: number, y: number): string {
  const c = cellAt(s, x, y);
  const lvl = surveyLevel(s, x, y);
  const lines = [`<b>${t('ex.cellName', { x, y })}</b> · ${t(TERRAIN[c.terrain])}`, `<span class="muted">${t(SURVEY[lvl])}</span>`];
  const heat = heatEstimate(s, x, y);
  if (heat !== null) lines.push(`${t('ex.geoChance')} ${fmtPct(heat)}`);
  const cos = cosEstimate(s, x, y);
  if (cos !== null) lines.push(`<span class="amber">${t('ex.ttLead', { p: cos })}</span>`);
  const size = leadSizeEstimate(s, x, y);
  if (size) lines.push(t('ex.ttP50', { v: size.p50 }));
  if (c.drilled === 'dry') lines.push(`<span class="bad">${t('ex.dryHole')}</span>`);
  if (c.fieldId > 0) lines.push(`<span class="good">${s.fields.find((f) => f.id === c.fieldId)?.name}</span>`);
  return lines.join('<br>');
}
