import { helpBody, helpTitle, type HelpId } from '../i18n';

export interface HelpView {
  title: string;
  body?: string;
  /** Live status line, e.g. why a button is disabled. */
  note?: string;
  noteCls?: 'bad' | 'good' | 'amber';
}

/** A glossary entry, or a function that builds the card when it is shown. */
export type HelpSource = HelpId | (() => HelpView | null);

const sources = new WeakMap<Element, HelpSource>();

export function term(id: HelpId): HelpView {
  return { title: helpTitle(id), body: helpBody(id) };
}

/**
 * Attach a hover explanation to an element. Plain-text terms get a dotted
 * underline so players know there is something to read.
 */
export function help<E extends Element>(el: E, src: HelpSource, underline = true): E {
  sources.set(el, src);
  if (underline) el.classList.add('help-term');
  return el;
}

function resolve(el: Element): HelpView | null {
  const src = sources.get(el);
  if (!src) return null;
  return typeof src === 'function' ? src() : term(src);
}

function div(cls: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = cls;
  return el;
}

function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

const SHOW_DELAY = 350;
const HIDE_DELAY = 120;

/**
 * Floating card for whatever help-tagged element is under the pointer.
 * Panel items get the card beside the panel, over the scene; top and bottom
 * bar items get it above or below.
 */
export class HelpCard {
  private anchor: Element | null = null;
  private timer = 0;
  private titleEl = div('help-title');
  private bodyEl = div('help-body');
  private noteEl = div('help-note');

  constructor(private el: HTMLElement) {
    el.append(this.titleEl, this.bodyEl, this.noteEl);
    // pointermove as well: after a scroll hides the card, the next nudge brings it back.
    document.addEventListener('pointerover', (e) => this.over(e.target));
    document.addEventListener('pointermove', (e) => this.over(e.target), { passive: true });
    document.documentElement.addEventListener('pointerleave', () => this.leave());
    document.addEventListener('scroll', () => this.leave(), true);
  }

  /** Re-render while visible so live notes (costs, reasons) stay current. */
  update(): void {
    if (!this.el.hidden) this.render();
  }

  hide(): void {
    this.el.hidden = true;
  }

  private over(target: EventTarget | null): void {
    let el = target instanceof Element ? target : null;
    while (el && !sources.has(el)) el = el.parentElement;
    if (el === this.anchor) return;
    this.anchor = el;
    clearTimeout(this.timer);
    if (!el) this.timer = window.setTimeout(() => this.hide(), HIDE_DELAY);
    else if (this.el.hidden) this.timer = window.setTimeout(() => this.render(), SHOW_DELAY);
    else this.render();
  }

  private leave(): void {
    this.anchor = null;
    clearTimeout(this.timer);
    this.hide();
  }

  private render(): void {
    const a = this.anchor;
    const v = a?.isConnected ? resolve(a) : null;
    if (!a || !v) {
      this.hide();
      return;
    }
    setText(this.titleEl, v.title);
    setText(this.bodyEl, v.body ?? '');
    setText(this.noteEl, v.note ?? '');
    this.bodyEl.hidden = !v.body;
    this.noteEl.hidden = !v.note;
    this.noteEl.className = `help-note ${v.noteCls ?? ''}`;
    this.el.hidden = false;
    this.place(a);
  }

  private place(a: Element): void {
    const r = a.getBoundingClientRect();
    const cw = this.el.offsetWidth, ch = this.el.offsetHeight;
    const vw = window.innerWidth, vh = window.innerHeight;
    const gap = 8, edge = 6;
    const panel = a.closest('#left, #right');
    let x: number, y: number;
    if (panel) {
      const p = panel.getBoundingClientRect();
      x = panel.id === 'left' ? p.right + gap : p.left - gap - cw;
      y = r.top;
    } else if (a.closest('#bottom')) {
      x = r.left;
      y = r.top - gap - ch;
    } else {
      x = r.left;
      y = r.bottom + gap;
    }
    // Narrow layouts stack the panels; fall back to below the element.
    if (x < edge || x + cw > vw - edge) {
      x = r.left;
      y = r.bottom + gap;
    }
    x = Math.max(edge, Math.min(vw - cw - edge, x));
    y = Math.max(edge, Math.min(vh - ch - edge, y));
    this.el.style.left = `${Math.round(x)}px`;
    this.el.style.top = `${Math.round(y)}px`;
  }
}
