import { fmtDate, fmtMoney, fmtPct, fmtPrice, fmtRate } from '../game/format';
import { getLang, LANGS, t, type HelpId, type Lang, type MsgKey } from '../i18n';
import { h, setText, toggleClass } from './dom';
import type { Ctx } from './ctx';
import { help } from './help';
import { confirmModal } from './modal';
import { sparkline } from './charts';

// Languages are listed by their own names, as on most sites.
const LANG_NAMES: Record<Lang, string> = { en: 'English', ru: 'Русский' };

const GEAR_SVG = '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">' +
  '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="3.2" stroke-dasharray="3.1 3.18"/>' +
  '<circle cx="12" cy="12" r="5.6" fill="none" stroke="currentColor" stroke-width="2.6"/></svg>';

/** Gear button with a dropdown: save, new game, language. Keeps rarely used actions out of the top bar. */
function settingsMenu(ctx: Ctx): HTMLElement {
  const gear = h('button', { class: 'btn small gear', title: t('menu.title'), 'aria-haspopup': 'menu', 'aria-expanded': 'false' });
  gear.innerHTML = GEAR_SVG;
  const list = h('div', { class: 'dropdown', role: 'menu', hidden: true });
  const wrap = h('div', { class: 'settings' }, gear, list);
  const close = () => {
    list.hidden = true;
    gear.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', esc, true);
  };
  const outside = (e: Event) => { if (!wrap.contains(e.target as Node)) close(); };
  const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  gear.addEventListener('click', () => {
    if (!list.hidden) return close();
    list.hidden = false;
    gear.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', esc, true);
  });
  const item = (label: string, onPick: () => void, cls = '') =>
    h('button', { class: `item ${cls}`, role: 'menuitem', onclick: () => { close(); onPick(); } }, label);
  list.append(
    item(t('menu.save'), () => ctx.save()),
    item(t('menu.new'), () => confirmModal(t('top.newTitle'), t('top.newText'), t('top.newOk'), () => ctx.newGame())),
    h('div', { class: 'sep' }),
    h('div', { class: 'head' }, t('menu.lang')),
    ...LANGS.map((l) => item(LANG_NAMES[l], () => ctx.setLang(l), l === getLang() ? 'on' : '')),
  );
  return wrap;
}

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
    const label = (key: MsgKey, id?: HelpId) => {
      const el = h('div', { class: 'label' }, t(key));
      return id ? help(el, id) : el;
    };
    const stat = (key: MsgKey, value: HTMLElement, id?: HelpId) => h('div', { class: 'stat' }, label(key, id), value);
    const speeds = [0, 1, 2, 5];
    this.speedBtns = speeds.map((sp) =>
      h('button', { class: 'btn small', onclick: () => ctx.setSpeed(sp), title: sp ? t('top.speed', { n: sp }) : t('top.pause') }, sp ? `${sp}×` : '❚❚'),
    );
    root.append(
      h('div', { class: 'brand' }, h('span', { class: 'drop' }), 'DRAWDOWN'),
      stat('top.cash', this.cash, 'cash'),
      stat('top.net', this.profit, 'net'),
      stat('top.oil', this.oil, 'oil'),
      stat('top.wc', this.wc, 'wc'),
      h('div', { class: 'stat price' }, h('div', null, label('top.crude', 'crude'), this.price), this.spark),
      stat('top.date', this.date),
      h('div', { class: 'top-spacer' }),
      h('div', { class: 'speed' }, ...this.speedBtns),
      h('div', { class: 'menu' }, settingsMenu(ctx)),
    );
  }

  update(): void {
    const s = this.ctx.s;
    const fl = s.flows;
    setText(this.cash, fmtMoney(s.cash));
    toggleClass(this.cash, 'bad', s.cash < 0);
    // Totals across the onshore hub and every platform.
    const tot = fl.total;
    setText(this.profit, (tot.profit >= 0 ? '+' : '') + fmtMoney(tot.profit));
    toggleClass(this.profit, 'good', tot.profit > 0);
    toggleClass(this.profit, 'bad', tot.profit < 0);
    setText(this.oil, fmtRate(tot.oil));
    setText(this.wc, tot.liquid > 0 ? fmtPct(tot.water / tot.liquid) : '—');
    const sale = s.market.price * (1 - s.market.impact);
    this.price.innerHTML = `${fmtPrice(s.market.price)} <small>→ ${fmtPrice(sale)}</small>`;
    setText(this.date, fmtDate(s.day));
    this.speedBtns.forEach((b, i) => toggleClass(b, 'on', [0, 1, 2, 5][i] === this.ctx.ui.speed));
    if (s.history.price.length !== this.sparkLen) {
      this.sparkLen = s.history.price.length;
      sparkline(this.spark, s.history.price.slice(-180), '#e8a23a');
    }
  }
}
