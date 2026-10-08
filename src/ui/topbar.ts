import { fmtDate, fmtMoney, fmtPct, fmtRate } from '../game/format';
import { ActionButton, h, setText, toggleClass } from './dom';
import type { Ctx } from './ctx';
import { confirmModal } from './modal';
import { sparkline } from './charts';

export class TopBar {
  private cash = h('div', { class: 'value' });
  private profit = h('div', { class: 'value' });
  private oil = h('div', { class: 'value oil' });
  private wc = h('div', { class: 'value water' });
  private price = h('div', { class: 'value' });
  private date = h('div', { class: 'value' });
  private spark = h('canvas', { width: 96, height: 30 });
  private speedBtns: HTMLButtonElement[] = [];
  private sparkLen = -1;

  constructor(root: HTMLElement, private ctx: Ctx) {
    const stat = (label: string, value: HTMLElement, title?: string) =>
      h('div', { class: 'stat', title }, h('div', { class: 'label' }, label), value);
    const speeds = [0, 1, 2, 5];
    this.speedBtns = speeds.map((sp) =>
      h('button', { class: 'btn small', onclick: () => ctx.setSpeed(sp), title: sp ? `${sp} game day/s` : 'Pause (Space)' }, sp ? `${sp}×` : '❚❚'),
    );
    const save = new ActionButton('Save', () => ({ ok: true, cost: 0 }), () => ctx.save(), { cls: 'small ghost', showCost: false });
    const reset = new ActionButton('New', () => ({ ok: true, cost: 0 }), () =>
      confirmModal('New game', 'Abandon this company and start over with one tired pumpjack?', 'Start over', () => ctx.newGame()),
      { cls: 'small ghost', showCost: false });
    root.append(
      h('div', { class: 'brand' }, h('span', { class: 'drop' }), 'DRAWDOWN'),
      stat('Cash', this.cash),
      stat('Net / day', this.profit),
      stat('Oil', this.oil, 'Oil production rate'),
      stat('Water cut', this.wc, 'Share of water in produced liquid'),
      h('div', { class: 'stat price', title: 'Spot price · price you actually get after market impact' },
        h('div', null, h('div', { class: 'label' }, 'Crude'), this.price), this.spark),
      stat('Date', this.date),
      h('div', { class: 'top-spacer' }),
      h('div', { class: 'speed' }, ...this.speedBtns),
      h('div', { class: 'menu' }, save.el, reset.el),
    );
  }

  update(): void {
    const s = this.ctx.s;
    const fl = s.flows;
    setText(this.cash, fmtMoney(s.cash));
    toggleClass(this.cash, 'bad', s.cash < 0);
    setText(this.profit, (fl.profit >= 0 ? '+' : '') + fmtMoney(fl.profit));
    toggleClass(this.profit, 'good', fl.profit > 0);
    toggleClass(this.profit, 'bad', fl.profit < 0);
    setText(this.oil, fmtRate(fl.oil));
    setText(this.wc, fl.liquid > 0 ? fmtPct(fl.water / fl.liquid) : '—');
    const sale = s.market.price * (1 - s.market.impact);
    this.price.innerHTML = `$${s.market.price.toFixed(2)} <small>→ $${sale.toFixed(2)}</small>`;
    setText(this.date, fmtDate(s.day));
    this.speedBtns.forEach((b, i) => toggleClass(b, 'on', [0, 1, 2, 5][i] === this.ctx.ui.speed));
    if (s.history.price.length !== this.sparkLen) {
      this.sparkLen = s.history.price.length;
      sparkline(this.spark, s.history.price.slice(-180), '#e8a23a');
    }
  }
}
