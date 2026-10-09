import {
  buyTech, developCost, developField, drillWildcat, surveyBlock, surveyDays,
} from '../game/actions';
import { EXPLORATION, OFFSHORE } from '../game/balance';
import {
  blockOf, cellAt, cosEstimate, heatEstimate, isDrillable, leadSizeEstimate, mapCfg, mapOf, surveyLevel,
} from '../game/explore';
import { fmtBbl, fmtDays, fmtGor, fmtNum, fmtPct } from '../game/format';
import { installCost, platformOfField } from '../game/platform';
import { reserveEstimate } from '../game/reservoir';
import type { Field, GameState, MapId } from '../game/types';
import { t, type HelpId, type MsgKey } from '../i18n';
import { ActionButton, bar, h, setBar, setText } from './dom';
import type { Ctx } from './ctx';
import { help, term } from './help';

const TERRAIN: MsgKey[] = [
  'terrain.plain', 'terrain.hills', 'terrain.marsh', 'terrain.lake',
  'terrain.coast', 'terrain.shallow', 'terrain.midShelf', 'terrain.outerShelf', 'terrain.slope',
];
const SURVEY: MsgKey[] = ['survey.none', 'survey.none', 'survey.2d', 'survey.3d'];

/** Fields that belong to a map, minus the inherited home field. */
function mapFields(s: GameState, map: MapId): Field[] {
  return s.fields.filter((f) => f.id !== 1 && !!f.offshore === (map === 'shelf'));
}

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

  private get map(): MapId {
    return this.ctx.ui.map === 'shelf' && this.ctx.s.shelf ? 'shelf' : 'land';
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
    const map = this.map;
    const ex = mapOf(s, map);
    if (!sel) {
      if (this.cellKey !== 'none') {
        this.cellKey = 'none';
        this.cellUpdate = null;
        this.cellBox.replaceChildren(h('div', { class: 'empty' }, t(map === 'shelf' ? 'ex.clickCellShelf' : 'ex.clickCell')));
      }
      return;
    }
    const { x, y } = sel;
    const c = cellAt(ex, x, y);
    const fld = s.fields.find((f) => f.id === c.fieldId);
    const key = `${map}|${x},${y}|${surveyLevel(ex, x, y)}|${c.drilled}|${c.fieldId}|${fld?.developed}|${!!fld?.devJob}|${fld?.abandoned}|` +
      `${s.techs.exploration}|${s.techs.seismic3d}|${fld ? !!platformOfField(s, fld.id) : ''}`;
    if (key !== this.cellKey) {
      this.cellKey = key;
      const cfg = mapCfg(map);
      const blk = blockOf(ex, x, y);
      const lvl = surveyLevel(ex, x, y);
      const btns: ActionButton[] = [];
      let devUpdate: (() => void) | null = null;
      const kv: Node[] = [];
      const row = (k: string, v: string, cls = '', id?: HelpId) => {
        const label = h('span', { class: 'k' }, k);
        kv.push(id ? help(label, id) : label, h('span', { class: `v ${cls}` }, v));
      };
      row(t(map === 'shelf' ? 'ex.depth' : 'ex.terrain'), t(TERRAIN[c.terrain]), c.terrain === 8 ? 'faint' : '', map === 'shelf' ? 'depth' : 'terrain');
      row(t('ex.block', { n: blk + 1 }), t(SURVEY[lvl]), '', 'survey');
      const heat = heatEstimate(ex, x, y);
      if (heat !== null) row(t('ex.geoChance'), fmtPct(heat), '', 'geoChance');
      const cos = cosEstimate(ex, x, y);
      if (cos !== null) row(t('ex.cos'), t('ex.cosVal', { p: cos, e: lvl === 3 ? 6 : 18 }), 'amber', 'cos');
      else if (lvl > 0 && c.drilled === 'none') row(t('ex.lead'), t(lvl === 3 ? 'ex.noneMapped' : 'ex.noneSeen'), 'faint', 'lead');
      const size = leadSizeEstimate(ex, x, y);
      if (size) row(t('ex.size'), `${fmtNum(size.p90)} / ${fmtNum(size.p50)} / ${fmtNum(size.p10)}`, '', 'eur');
      if (c.drilled === 'dry') row(t('ex.result'), t('ex.dryHole'), 'bad');
      if (c.terrain === 8) row(t('ex.result'), t('ex.tooDeepNote'), 'faint');

      const field = fld;
      const badge = !field ? null
        : field.abandoned ? ['', 'ex.abandoned']
          : field.developed ? ['good', 'ex.producing']
            : field.devJob ? ['amber', 'ex.building'] : ['amber', 'ex.discovery'];
      const body: (Node | null)[] = [
        h('div', { class: 'title-row' }, h('span', { class: 'name' }, field ? field.name : t('ex.cellName', { x, y })),
          badge ? h('span', { class: `badge right ${badge[0]}` }, t(badge[1] as MsgKey)) : null),
        h('div', { class: 'kv' }, ...kv),
      ];

      if (field && field.offshore && !field.abandoned && platformOfField(s, field.id) && !field.devJob) {
        const go = h('button', { class: 'btn primary block', onclick: () => ctx.selectPlatform(platformOfField(ctx.s, field.id)!.id) }, t('ex.toPlatform'));
        body.push(h('div', { class: 'btn-row' }, go));
      }
      if (field && !field.developed && !field.abandoned) {
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
          body.push(h('div', { class: 'progress' }, h('div', { class: 'lbl' }, h('span', null, t(field.offshore ? 'ex.buildingPlatform' : 'ex.buildingPad')), lbl), pb));
          devUpdate = () => {
            if (!field.devJob) return;
            setText(lbl, fmtDays(field.devJob.daysLeft));
            setBar(pb, 1 - field.devJob.daysLeft / field.devJob.total);
          };
        } else if (field.offshore) {
          const b = new ActionButton(t('ex.install', { days: OFFSHORE.installDays }), () => developField(ctx.s, field.id, true), () => ctx.act((st) => developField(st, field.id)),
            { cls: 'primary block', help: () => ({ ...term('install'), body: `${t('help.install.b')} ${t('ex.installCost', { cost: installCost(ctx.s, field) })}` }) });
          btns.push(b);
          body.push(h('div', { class: 'btn-row' }, b.el));
        } else {
          const b = new ActionButton(t('ex.develop', { days: EXPLORATION.developDays }), () => developField(ctx.s, field.id, true), () => ctx.act((st) => developField(st, field.id)),
            { cls: 'primary block', help: () => ({ ...term('develop'), body: `${t('help.develop.b')} ${t('ex.developCost', { cost: developCost(ctx.s, field.id) })}` }) });
          btns.push(b);
          body.push(h('div', { class: 'btn-row' }, b.el));
        }
      }

      const surveyHelp = (title: MsgKey, hint: MsgKey) => () => ({ title: t(title), body: t(hint) });
      const sv2 = new ActionButton(t('ex.sv2', { days: surveyDays(2, map) }), () => surveyBlock(ctx.s, blk, 2, true, map), () => ctx.act((st) => surveyBlock(st, blk, 2, false, map)),
        { cls: 'small', help: surveyHelp('survey.2d', 'ex.sv2Hint') });
      const sv3 = new ActionButton(t('ex.sv3', { days: surveyDays(3, map) }), () => surveyBlock(ctx.s, blk, 3, true, map), () => ctx.act((st) => surveyBlock(st, blk, 3, false, map)),
        { cls: 'small', help: surveyHelp('survey.3d', 'ex.sv3Hint') });
      btns.push(sv2, sv3);
      body.push(h('div', { class: 'btn-grid' }, sv2.el, sv3.el));
      if (isDrillable(ex, x, y)) {
        const wc = new ActionButton(t('ex.wildcat', { days: cfg.wildcatDays }), () => drillWildcat(ctx.s, x, y, true, map), () => ctx.act((st) => drillWildcat(st, x, y, false, map)),
          { cls: 'primary block', help: () => ({ ...term(map === 'shelf' ? 'shelfWildcat' : 'wildcat'), note: c.lead ? undefined : t('ex.blind'), noteCls: 'amber' }) });
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
    const map = this.map;
    const ex = mapOf(s, map);
    const storm = map === 'shelf' && s.weather.storm > 0;
    const key = `${map}|${storm}|${ex.wildcat ? `${ex.wildcat.x},${ex.wildcat.y}` : '-'}|${ex.surveys.map((v) => v.block + ':' + v.kind).join(',')}`;
    if (key !== this.opsKey) {
      this.opsKey = key;
      const items: { lbl: HTMLElement; bar: HTMLElement; get: () => [number, number] }[] = [];
      const rows: Node[] = [];
      if (storm) rows.push(help(h('div', { class: 'storm-note' }, t('ex.stormHold')), 'storm', false));
      const add = (title: string, get: () => [number, number]) => {
        const lbl = h('span');
        const b = bar('tall');
        items.push({ lbl, bar: b, get });
        rows.push(h('div', { class: 'progress' }, h('div', { class: 'lbl' }, h('span', null, title), lbl), b));
      };
      if (ex.wildcat) {
        const w = ex.wildcat;
        add(t(map === 'shelf' ? 'ex.jackupAt' : 'ex.rigAt', { x: w.x, y: w.y }), () => [ex.wildcat?.daysLeft ?? 0, w.total]);
      }
      for (const sv of ex.surveys) add(t(map === 'shelf' ? 'ex.vessel' : 'ex.crew', { kind: sv.kind, n: sv.block + 1 }), () => [sv.daysLeft, sv.total]);
      if (!ex.wildcat && !ex.surveys.length) rows.push(h('div', { class: 'empty' }, t(map === 'shelf' ? 'ex.idleShelf' : 'ex.idle')));
      this.ops.replaceChildren(...rows);
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
    const map = this.map;
    const found = mapFields(s, map);
    const key = map + found.map((f) => `${f.id}:${f.developed}:${!!f.devJob}:${!!f.abandoned}`).join(',');
    if (key !== this.findsKey) {
      this.findsKey = key;
      const rows = found.map((f) => {
        const est = reserveEstimate(f);
        const sel = h('button', { class: 'btn small ghost', onclick: () => this.ctx.selectCell(f.cellX, f.cellY) }, t('ex.show'));
        const state = t(f.abandoned ? 'ex.fAbandoned' : f.developed ? 'ex.fProducing' : f.devJob ? 'ex.fBuilding' : 'ex.fAwaiting');
        return h('div', { class: 'tech' },
          h('span', { class: 'nm' }, f.name),
          sel,
          h('div', { class: 'desc' }, `${state} · P50 ${fmtBbl(est.p50)}`));
      });
      this.finds.replaceChildren(...(rows.length ? rows : [h('div', { class: 'empty' }, t(map === 'shelf' ? 'ex.nothingShelf' : 'ex.nothing'))]));
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

export function cellTooltip(s: GameState, map: MapId, x: number, y: number): string {
  const ex = mapOf(s, map);
  const c = cellAt(ex, x, y);
  const lvl = surveyLevel(ex, x, y);
  const lines = [`<b>${t('ex.cellName', { x, y })}</b> · ${t(TERRAIN[c.terrain])}`, `<span class="muted">${t(SURVEY[lvl])}</span>`];
  const heat = heatEstimate(ex, x, y);
  if (heat !== null) lines.push(`${t('ex.geoChance')} ${fmtPct(heat)}`);
  const cos = cosEstimate(ex, x, y);
  if (cos !== null) lines.push(`<span class="amber">${t('ex.ttLead', { p: cos })}</span>`);
  const size = leadSizeEstimate(ex, x, y);
  if (size) lines.push(t('ex.ttP50', { v: size.p50 }));
  if (c.drilled === 'dry') lines.push(`<span class="bad">${t('ex.dryHole')}</span>`);
  if (c.terrain === 8) lines.push(`<span class="faint">${t('ex.tooDeepNote')}</span>`);
  if (c.fieldId > 0) lines.push(`<span class="good">${s.fields.find((f) => f.id === c.fieldId)?.name}</span>`);
  return lines.join('<br>');
}
