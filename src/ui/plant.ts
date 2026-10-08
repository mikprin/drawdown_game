import { buyFacility, buyTech, setSellMode, setThreshold, techLockReason } from '../game/actions';
import { TECHS } from '../game/balance';
import { fmtGasNum, fmtMoney, fmtNum, fmtPrice } from '../game/format';
import { cap, facilityNextValue } from '../game/reservoir';
import type { CostId, FacilityId, SellMode, TechId } from '../game/types';
import { t, type HelpId, type MsgKey } from '../i18n';
import { ActionButton, bar, h, setBar, setText, toggleClass } from './dom';
import type { Ctx } from './ctx';
import { help, term, type HelpSource, type HelpView } from './help';

interface Gauge {
  val: HTMLElement;
  bar: HTMLElement;
}

const facHelp = (id: FacilityId): HelpView => ({ title: t(`fac.${id}.name`), body: t(`fac.${id}.desc`) });

export class PlantPanel {
  readonly el = h('div');
  private buttons: ActionButton[] = [];
  private nodes: Record<string, HTMLElement> = {};
  private g: Record<string, Gauge> = {};
  private price = h('div', { class: 'big-price' });
  private priceSub = h('div', { class: 'muted' });
  private modeBtns: Record<SellMode, HTMLButtonElement>;
  private thresh = h('span', { class: 'val' });
  private threshRow: HTMLElement;
  private pnl = h('div', { class: 'pnl' });
  private techRows: { id: TechId; el: HTMLElement; btn: ActionButton }[] = [];
  private storageAside = h('span', { class: 'aside' });

  constructor(private ctx: Ctx) {
    const gauge = (key: string, kind = '') => {
      this.g[key] = { val: h('span', { class: 'val' }), bar: bar(kind) };
      return this.g[key];
    };
    const upg = (id: FacilityId, labelKey: MsgKey) => {
      const label = t(labelKey);
      const fmtValue = id === 'compressor' ? fmtGasNum : fmtNum;
      const b = new ActionButton(label, () => buyFacility(ctx.s, id, true), () => ctx.act((s) => buyFacility(s, id)), {
        cls: 'small',
        help: () => facHelp(id),
        labelFn: () => {
          const nv = facilityNextValue(id, ctx.s.facilities[id]);
          return nv === null ? `${label} · ${t('plant.max')}` : `${label} → ${fmtValue(nv)}`;
        },
      });
      this.buttons.push(b);
      return b.el;
    };
    // A plant stage flagged as the bottleneck says so in its card.
    const withNote = (base: () => HelpView, note: () => string | null): HelpSource => () => {
      const n = note();
      return n ? { ...base(), note: n, noteCls: 'bad' } : base();
    };
    const bnNote = (k: string) => () => (ctx.s.flows.bottleneck === k ? `${t('plant.bottleneckNote')} ${t('help.bottleneck.b')}` : null);
    const node = (key: string, nameKey: MsgKey, src: HelpSource, gk: string, kind: string, ...extra: (Node | null)[]) => {
      const gg = gauge(gk, kind);
      this.nodes[key] = h('div', { class: 'node', 'data-bn': t('plant.bottleneck'), 'data-ll': t('plant.liftLimited') },
        h('div', { class: 'node-head' }, help(h('span', { class: 'nm' }, t(nameKey)), src), gg.val),
        gg.bar, ...extra);
      return this.nodes[key];
    };
    const sub = (labelKey: MsgKey, src: HelpSource, gk: string, kind: string, ...btns: Node[]) => {
      const gg = gauge(gk, kind);
      return h('div', { class: 'sub-node' },
        h('div', { class: 'row' }, help(h('span', { class: 'muted' }, t(labelKey)), src), gg.val), gg.bar,
        btns.length ? h('div', { class: 'btn-row' }, ...btns) : null);
    };
    const arrow = () => h('div', { class: 'flow-arrow' });
    const title = (key: MsgKey, id: HelpId, ...aside: Node[]) =>
      h('div', { class: 'section-title' }, help(h('span', null, t(key)), id), ...aside);

    const mode = (m: SellMode, key: MsgKey, id: HelpId) =>
      help(h('button', { class: 'btn small', onclick: () => ctx.act((s) => setSellMode(s, m)) }, t(key)), id, false);
    this.modeBtns = {
      auto: mode('auto', 'mode.auto', 'sellAuto'),
      threshold: mode('threshold', 'mode.floor', 'sellFloor'),
      hold: mode('hold', 'mode.hold', 'sellHold'),
    };
    const step = (d: number) =>
      h('button', { class: 'btn small', onclick: () => ctx.act((s) => setThreshold(s, s.market.threshold + d)) }, d > 0 ? `+${d}` : `−${-d}`);
    this.threshRow = h('div', { class: 'stepper' }, step(-5), step(-1), this.thresh, step(1), step(5));

    const liftNote = () => {
      const n = ctx.s.flows.liftLimitedWells;
      return n > 0 ? `${t('plant.liftLimitedNote', { n })} ${t('help.liftLimited.b')}` : null;
    };
    const injNote = () => t('plant.injNote', { v: ctx.s.flows.injFromProduced });

    this.el.append(
      h('div', { class: 'section' },
        title('plant.title', 'plant'),
        node('wells', 'plant.wells', withNote(() => term('wellsNode'), liftNote), 'wells', 'good'),
        arrow(),
        node('separator', 'plant.separator', withNote(() => facHelp('separator'), bnNote('separator')), 'sep', '',
          h('div', { class: 'btn-row' }, upg('separator', 'plant.upgrade'))),
        arrow(),
        h('div', { class: 'split' },
          node('storage', 'plant.tanks', withNote(() => facHelp('storage'), bnNote('storage')), 'tank', '',
            h('div', { class: 'btn-row' }, upg('storage', 'plant.tanksBtn'))),
          node('export', 'plant.export', 'export', 'export', '',
            h('div', { class: 'btn-row' }, upg('trucks', 'plant.truck'), upg('pipeline', 'plant.pipeline'))),
          node('water', 'plant.water', withNote(() => term('water'), bnNote('water')), 'water', 'water',
            h('div', { style: 'margin-top:8px' },
              sub('plant.reinj', () => ({ ...facHelp('injection'), note: injNote() }), 'inj', 'water', upg('injection', 'plant.pumps')),
              sub('plant.swd', () => facHelp('swd'), 'swd', 'water', upg('swd', 'plant.swdBtn')),
              sub('plant.wtrucks', () => facHelp('waterTrucks'), 'wtr', 'water', upg('waterTrucks', 'plant.truck')))),
          node('gas', 'plant.gas', 'gas', 'gas', 'gas',
            h('div', { style: 'margin-top:8px' },
              sub('plant.gasSold', () => facHelp('compressor'), 'gsold', 'gas', upg('compressor', 'plant.compressor')),
              sub('plant.flared', 'flaring', 'gflare', 'gas'))),
        ),
      ),
      h('div', { class: 'section' },
        title('market.title', 'market', this.storageAside),
        this.price, help(this.priceSub, 'impact', false),
        h('div', { class: 'seg' }, this.modeBtns.auto, this.modeBtns.threshold, this.modeBtns.hold),
        this.threshRow,
      ),
      h('div', { class: 'section' }, title('pnl.title', 'pnl'), this.pnl),
      h('div', { class: 'section' }, title('tech.title', 'tech'), this.buildTechs()),
    );
  }

  private buildTechs(): HTMLElement {
    const ctx = this.ctx;
    const wrap = h('div');
    for (const id of Object.keys(TECHS) as TechId[]) {
      const view = () => ({ title: t(`tech.${id}.name`), body: t(`tech.${id}.desc`) });
      const btn = new ActionButton(t('btn.buy'), () => buyTech(ctx.s, id, true), () => ctx.act((s) => buyTech(s, id)), { cls: 'small primary', help: view });
      const el = h('div', { class: 'tech' }, h('span', { class: 'nm' }, t(`tech.${id}.name`)), btn.el, h('div', { class: 'desc' }, t(`tech.${id}.desc`)));
      this.techRows.push({ id, el, btn });
      wrap.append(el);
    }
    return wrap;
  }

  update(): void {
    const s = this.ctx.s;
    const fl = s.flows;
    const bpd = ' ' + t('unit.bpd');
    const gas = ' ' + t('unit.gas');
    const set = (k: string, num: number, den: number, unit = '', fmt = fmtNum) => {
      const gg = this.g[k];
      gg.val.innerHTML = `<b>${fmt(num)}</b> / ${fmt(den)}${unit}`;
      setBar(gg.bar, den > 0 ? num / den : 0);
    };
    set('wells', fl.liquid, fl.liquidPotential, bpd);
    set('sep', fl.liquid, fl.sepCap, bpd);
    set('tank', s.storage, fl.storageCap || cap(s, 'storage'), ' ' + t('unit.bbl'));
    set('export', fl.sold, fl.exportCap, bpd);
    set('water', fl.water, fl.waterCap, bpd);
    set('inj', fl.injected, cap(s, 'injection'), bpd);
    set('swd', fl.swd, cap(s, 'swd'), bpd);
    set('wtr', fl.waterTrucked, cap(s, 'waterTrucks'), bpd);
    set('gas', fl.gasSold, fl.gas, `${gas} ${t('plant.sold')}`, fmtGasNum);
    set('gsold', fl.gasSold, cap(s, 'compressor'), gas, fmtGasNum);
    this.g.gflare.val.innerHTML = `<b>${fmtGasNum(fl.gasFlared)}</b>${gas}`;
    setBar(this.g.gflare.bar, fl.gas > 0 ? fl.gasFlared / fl.gas : 0);

    for (const k of ['separator', 'storage', 'water'] as const) toggleClass(this.nodes[k], 'bottleneck', fl.bottleneck === k);
    toggleClass(this.nodes.wells, 'limited', fl.liftLimitedWells > 0);
    for (const b of this.buttons) b.update();

    const m = s.market;
    const sale = m.price * (1 - m.impact);
    setText(this.price, fmtPrice(m.price));
    setText(this.priceSub, t('market.realise', { sale, impact: m.impact }));
    setText(this.storageAside, t('market.inTanks', { v: s.storage }));
    for (const mode of Object.keys(this.modeBtns) as SellMode[]) toggleClass(this.modeBtns[mode], 'on', m.sellMode === mode);
    this.threshRow.style.display = m.sellMode === 'threshold' ? '' : 'none';
    setText(this.thresh, t('market.sellAbove', { v: m.threshold }));

    const rows: [string, number, string][] = [[t('pnl.sales'), fl.revenue, 'good']];
    for (const [k, v] of Object.entries(fl.costs) as [CostId, number][]) if (v > 0.5) rows.push([t(`cost.${k}`), -v, '']);
    const html = rows.map(([k, v, c]) => `<span class="muted">${k}</span><span class="num ${c}">${v >= 0 ? '+' : ''}${fmtMoney(v)}</span>`).join('') +
      `<span class="total">${t('pnl.net')}</span><span class="total num ${fl.profit >= 0 ? 'good' : 'bad'}">${fl.profit >= 0 ? '+' : ''}${fmtMoney(fl.profit)}</span>`;
    if (this.pnl.innerHTML !== html) this.pnl.innerHTML = html;

    for (const row of this.techRows) {
      const owned = s.techs[row.id];
      toggleClass(row.el, 'owned', owned);
      row.btn.el.style.display = owned ? 'none' : '';
      const lock = techLockReason(s, row.id);
      row.btn.setLabel(t(lock && lock.key !== 'reason.owned' ? 'btn.locked' : 'btn.buy'));
      row.btn.update();
      if (!owned) setText(row.btn.el.querySelector('.cost')!, fmtMoney(TECHS[row.id].cost));
    }
  }
}
