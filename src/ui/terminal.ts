import { buildTerminal, upgradeTerminal, type TerminalPart } from '../game/actions';
import { TERMINAL } from '../game/balance';
import { fmtNum } from '../game/format';
import { t, type MsgKey } from '../i18n';
import { ActionButton, bar, h, setBar, setText, toggleClass } from './dom';
import type { Ctx } from './ctx';
import { help, type HelpView } from './help';

const partHelp = (part: TerminalPart): HelpView => ({
  title: t(part === 'tanks' ? 'terminal.tanks' : 'terminal.jetty'),
  body: t(part === 'tanks' ? 'terminal.tanksDesc' : 'terminal.jettyDesc'),
});

/** Coastal terminal card on the shelf's right panel: build it, then grow the tank farm and the export jetty. */
export class TerminalCard {
  readonly el = h('div', { class: 'section' });
  private aside = h('span', { class: 'aside' });
  private none: HTMLElement;
  private built: HTMLElement;
  private buttons: ActionButton[] = [];
  private tanksNode: HTMLElement;
  private tanksVal = h('span', { class: 'val' });
  private tanksBar = bar('');
  private jettyVal = h('span', { class: 'val' });
  private jettyBar = bar('');
  private waiting = h('div', { class: 'small-note bad' });

  constructor(private ctx: Ctx) {
    const build = new ActionButton(t('terminal.build'), () => buildTerminal(ctx.s, true), () => ctx.act((s) => buildTerminal(s)),
      { cls: 'primary block', help: 'terminal' });
    const up = (part: TerminalPart, labelKey: MsgKey) => {
      const label = t(labelKey);
      const b = new ActionButton(label, () => upgradeTerminal(ctx.s, part, true), () => ctx.act((s) => upgradeTerminal(s, part)), {
        cls: 'small',
        help: () => partHelp(part),
        labelFn: () => {
          const tm = ctx.s.terminal;
          const next = tm ? TERMINAL[part][tm[part] + 1] : undefined;
          return next ? `${label} → ${fmtNum(next.value)}` : `${label} · ${t('plant.max')}`;
        },
      });
      this.buttons.push(b);
      return b.el;
    };
    this.buttons.push(build);
    this.none = h('div', { class: 'card' }, h('p', { class: 'muted' }, t('terminal.none')), build.el);
    this.tanksNode = h('div', { class: 'node', 'data-bn': t('plant.bottleneck') },
      h('div', { class: 'node-head' }, help(h('span', { class: 'nm' }, t('terminal.tanksBtn')), () => partHelp('tanks')), this.tanksVal),
      this.tanksBar, this.waiting, h('div', { class: 'btn-row' }, up('tanks', 'terminal.tanksBtn')));
    this.built = h('div', null,
      this.tanksNode,
      h('div', { class: 'flow-arrow' }),
      h('div', { class: 'node' },
        h('div', { class: 'node-head' }, help(h('span', { class: 'nm' }, t('terminal.jetty')), () => partHelp('jetty')), this.jettyVal),
        this.jettyBar, h('div', { class: 'btn-row' }, up('jetty', 'terminal.jettyBtn'))));
    this.el.append(
      h('div', { class: 'section-title' }, help(h('span', null, t('terminal.title')), 'terminal'), this.aside),
      this.none, this.built);
  }

  update(): void {
    const s = this.ctx.s;
    const tm = s.terminal;
    const tf = s.flows.terminal;
    this.none.style.display = tm ? 'none' : '';
    this.built.style.display = tm ? '' : 'none';
    setText(this.aside, tm ? t('market.inTerminal', { v: tm.storage }) : '');
    if (tm && tf) {
      const bpd = ' ' + t('unit.bpd');
      this.tanksVal.innerHTML = `<b>${fmtNum(tm.storage)}</b> / ${fmtNum(tf.storageCap)} ${t('unit.bbl')}`;
      setBar(this.tanksBar, tf.storageCap > 0 ? tm.storage / tf.storageCap : 0);
      this.jettyVal.innerHTML = `<b>${fmtNum(tf.sold)}</b> / ${fmtNum(tf.exportCap)}${bpd}`;
      setBar(this.jettyBar, tf.exportCap > 0 ? tf.sold / tf.exportCap : 0);
      toggleClass(this.tanksNode, 'bottleneck', tf.waiting > 0);
      this.waiting.style.display = tf.waiting > 0 ? '' : 'none';
      setText(this.waiting, t('terminal.waiting', { n: tf.waiting }));
    }
    for (const b of this.buttons) b.update();
  }
}
