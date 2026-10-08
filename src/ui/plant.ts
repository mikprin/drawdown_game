import { buyFacility, buyTech, setSellMode, setThreshold, techLockReason } from '../game/actions';
import { FACILITIES, TECHS } from '../game/balance';
import { fmtBbl, fmtMoney, fmtNum, fmtPct } from '../game/format';
import { cap, facilityNextValue } from '../game/reservoir';
import type { FacilityId, SellMode, TechId } from '../game/types';
import { ActionButton, bar, h, setBar, setText, toggleClass } from './dom';
import type { Ctx } from './ctx';

interface Gauge {
  val: HTMLElement;
  bar: HTMLElement;
}

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
    const upg = (id: FacilityId, label: string) => {
      const b = new ActionButton(label, () => buyFacility(ctx.s, id, true), () => ctx.act((s) => buyFacility(s, id)), {
        cls: 'small',
        hint: FACILITIES[id].desc,
        labelFn: () => {
          const nv = facilityNextValue(id, ctx.s.facilities[id]);
          return nv === null ? `${label} · max` : `${label} → ${fmtNum(nv)}`;
        },
      });
      this.buttons.push(b);
      return b.el;
    };
    const node = (key: string, name: string, gk: string, kind: string, ...extra: (Node | null)[]) => {
      const gg = gauge(gk, kind);
      this.nodes[key] = h('div', { class: 'node' },
        h('div', { class: 'node-head' }, h('span', { class: 'nm' }, name), gg.val),
        gg.bar, ...extra);
      return this.nodes[key];
    };
    const sub = (label: string, gk: string, kind: string, ...btns: Node[]) => {
      const gg = gauge(gk, kind);
      return h('div', { class: 'sub-node' },
        h('div', { class: 'row' }, h('span', { class: 'muted' }, label), gg.val), gg.bar,
        btns.length ? h('div', { class: 'btn-row' }, ...btns) : null);
    };
    const arrow = () => h('div', { class: 'flow-arrow' });

    this.modeBtns = {
      auto: h('button', { class: 'btn small', onclick: () => ctx.act((s) => setSellMode(s, 'auto')), title: 'Sell everything export capacity allows' }, 'Auto'),
      threshold: h('button', { class: 'btn small', onclick: () => ctx.act((s) => setSellMode(s, 'threshold')), title: 'Sell only when the realised price is above your floor' }, 'Floor'),
      hold: h('button', { class: 'btn small', onclick: () => ctx.act((s) => setSellMode(s, 'hold')), title: 'Store oil, sell nothing. Full tanks choke the wells.' }, 'Hold'),
    };
    this.threshRow = h('div', { class: 'stepper' },
      h('button', { class: 'btn small', onclick: () => ctx.act((s) => setThreshold(s, s.market.threshold - 5)) }, '−5'),
      h('button', { class: 'btn small', onclick: () => ctx.act((s) => setThreshold(s, s.market.threshold - 1)) }, '−1'),
      this.thresh,
      h('button', { class: 'btn small', onclick: () => ctx.act((s) => setThreshold(s, s.market.threshold + 1)) }, '+1'),
      h('button', { class: 'btn small', onclick: () => ctx.act((s) => setThreshold(s, s.market.threshold + 5)) }, '+5'),
    );

    this.el.append(
      h('div', { class: 'section' },
        h('div', { class: 'section-title' }, 'Plant'),
        node('wells', 'Wells', 'wells', 'good'),
        arrow(),
        node('separator', 'Separator', 'sep', '', h('div', { class: 'btn-row' }, upg('separator', 'Upgrade'))),
        arrow(),
        h('div', { class: 'split' },
          node('storage', 'Oil → Tanks', 'tank', '', h('div', { class: 'btn-row' }, upg('storage', 'Tanks'))),
          node('export', 'Export', 'export', '',
            h('div', { class: 'btn-row' }, upg('trucks', 'Truck'), upg('pipeline', 'Pipeline'))),
          node('water', 'Water', 'water', 'water',
            h('div', { style: 'margin-top:8px' },
              sub('Re-injection', 'inj', 'water', upg('injection', 'Pumps')),
              sub('Disposal well', 'swd', 'water', upg('swd', 'SWD')),
              sub('Water trucks', 'wtr', 'water', upg('waterTrucks', 'Truck')))),
          node('gas', 'Gas', 'gas', 'gas',
            h('div', { style: 'margin-top:8px' },
              sub('Sold via compressor', 'gsold', 'gas', upg('compressor', 'Compressor')),
              sub('Flared', 'gflare', 'gas'))),
        ),
      ),
      h('div', { class: 'section' },
        h('div', { class: 'section-title' }, 'Crude market', this.storageAside),
        this.price, this.priceSub,
        h('div', { class: 'seg' }, this.modeBtns.auto, this.modeBtns.threshold, this.modeBtns.hold),
        this.threshRow,
      ),
      h('div', { class: 'section' }, h('div', { class: 'section-title' }, 'Daily P&L'), this.pnl),
      h('div', { class: 'section' }, h('div', { class: 'section-title' }, 'Technology'), this.buildTechs()),
    );
  }

  private buildTechs(): HTMLElement {
    const ctx = this.ctx;
    const wrap = h('div');
    for (const id of Object.keys(TECHS) as TechId[]) {
      const def = TECHS[id];
      const btn = new ActionButton('Buy', () => buyTech(ctx.s, id, true), () => ctx.act((s) => buyTech(s, id)), { cls: 'small primary' });
      const el = h('div', { class: 'tech' }, h('span', { class: 'nm' }, def.name), btn.el, h('div', { class: 'desc' }, def.desc));
      this.techRows.push({ id, el, btn });
      wrap.append(el);
    }
    return wrap;
  }

  update(): void {
    const s = this.ctx.s;
    const fl = s.flows;
    const set = (k: string, num: number, den: number, unit = '', fmt = fmtNum) => {
      const gg = this.g[k];
      gg.val.innerHTML = `<b>${fmt(num)}</b> / ${fmt(den)}${unit}`;
      setBar(gg.bar, den > 0 ? num / den : 0);
    };
    set('wells', fl.liquid, fl.liquidPotential, ' bbl/d');
    this.g.wells.val.title = 'Liquid flowing vs. what the wells could deliver';
    set('sep', fl.liquid, fl.sepCap, ' bbl/d');
    set('tank', s.storage, fl.storageCap || cap(s, 'storage'), ' bbl');
    set('export', fl.sold, fl.exportCap, ' bbl/d');
    set('water', fl.water, fl.waterCap, ' bbl/d');
    set('inj', fl.injected, cap(s, 'injection'), ' bbl/d');
    this.g.inj.val.title = `${fmtNum(fl.injFromProduced)} bbl/d from produced water; injector wells limit intake`;
    set('swd', fl.swd, cap(s, 'swd'), ' bbl/d');
    set('wtr', fl.waterTrucked, cap(s, 'waterTrucks'), ' bbl/d');
    set('gas', fl.gasSold, fl.gas, ' mcf/d sold');
    set('gsold', fl.gasSold, cap(s, 'compressor'), ' mcf/d');
    this.g.gflare.val.innerHTML = `<b>${fmtNum(fl.gasFlared)}</b> mcf/d`;
    setBar(this.g.gflare.bar, fl.gas > 0 ? fl.gasFlared / fl.gas : 0);

    for (const k of ['separator', 'storage', 'water'] as const) toggleClass(this.nodes[k], 'bottleneck', fl.bottleneck === k);
    toggleClass(this.nodes.wells, 'limited', fl.liftLimitedWells > 0);
    this.nodes.wells.title = fl.liftLimitedWells > 0 ? `${fl.liftLimitedWells} well(s) limited by their lift — upgrade artificial lift` : '';
    for (const b of this.buttons) b.update();

    const m = s.market;
    const sale = m.price * (1 - m.impact);
    setText(this.price, `$${m.price.toFixed(2)}`);
    setText(this.priceSub, `You realise $${sale.toFixed(2)} · market impact −${fmtPct(m.impact, 1)}`);
    setText(this.storageAside, `${fmtBbl(s.storage)} in tanks`);
    for (const mode of Object.keys(this.modeBtns) as SellMode[]) toggleClass(this.modeBtns[mode], 'on', m.sellMode === mode);
    this.threshRow.style.display = m.sellMode === 'threshold' ? '' : 'none';
    setText(this.thresh, `sell ≥ $${m.threshold}`);

    const rows: [string, number, string][] = [['Oil & gas sales', fl.revenue, 'good']];
    for (const [k, v] of Object.entries(fl.costs)) if (v > 0.5) rows.push([k, -v, '']);
    const html = rows.map(([k, v, c]) => `<span class="muted">${k}</span><span class="num ${c}">${v >= 0 ? '+' : ''}${fmtMoney(v)}</span>`).join('') +
      `<span class="total">Net</span><span class="total num ${fl.profit >= 0 ? 'good' : 'bad'}">${fl.profit >= 0 ? '+' : ''}${fmtMoney(fl.profit)}</span>`;
    if (this.pnl.innerHTML !== html) this.pnl.innerHTML = html;

    for (const t of this.techRows) {
      const owned = s.techs[t.id];
      toggleClass(t.el, 'owned', owned);
      t.btn.el.style.display = owned ? 'none' : '';
      const lock = techLockReason(s, t.id);
      t.btn.setLabel(lock && lock !== 'Owned' && !lock.startsWith('Need') ? 'Locked' : 'Buy');
      t.btn.update();
      if (!owned) {
        const cost = fmtMoney(TECHS[t.id].cost);
        const costEl = t.btn.el.querySelector('.cost')!;
        setText(costEl, cost);
      }
    }
  }
}
