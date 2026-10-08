import type { Result } from '../game/actions';
import { fmtMoney } from '../game/format';

type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, unknown> | null;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = String(v);
      else if (k === 'style') el.setAttribute('style', String(v));
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

export function append(el: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
}

/** Set text only when it changed (avoids layout churn at 5 Hz). */
export function setText(el: Element, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

export function setBar(bar: HTMLElement, frac: number): void {
  const i = bar.firstElementChild as HTMLElement;
  const w = `${Math.max(0, Math.min(100, frac * 100)).toFixed(1)}%`;
  if (i.style.width !== w) i.style.width = w;
}

export function bar(kind = ''): HTMLDivElement {
  return h('div', { class: `bar ${kind}` }, h('i'));
}

export function toggleClass(el: Element, cls: string, on: boolean): void {
  if (el.classList.contains(cls) !== on) el.classList.toggle(cls, on);
}

/**
 * Button bound to a game action. `check` is the dry-run; the button shows the
 * cost, and when disabled the reason appears as the tooltip.
 */
export class ActionButton {
  readonly el: HTMLButtonElement;
  private costEl: HTMLSpanElement;
  private labelEl: HTMLSpanElement;

  constructor(
    label: string,
    private check: () => Result,
    run: () => void,
    private opts: { cls?: string; showCost?: boolean; hint?: string; labelFn?: () => string } = {},
  ) {
    this.labelEl = h('span', null, label);
    this.costEl = h('span', { class: 'cost' });
    this.el = h('button', { class: `btn ${opts.cls ?? ''}` }, this.labelEl, opts.showCost === false ? null : this.costEl);
    this.el.addEventListener('click', () => {
      if (this.check().ok) run();
    });
  }

  setLabel(label: string): void {
    setText(this.labelEl, label);
  }

  update(): void {
    const r = this.check();
    this.el.disabled = !r.ok;
    if (this.opts.labelFn) setText(this.labelEl, this.opts.labelFn());
    const hint = this.opts.hint ?? '';
    if (r.ok) {
      setText(this.costEl, r.cost > 0 ? fmtMoney(r.cost) : '');
      this.el.title = hint;
    } else {
      const m = /^Need (.*)$/.exec(r.reason);
      setText(this.costEl, m ? m[1] : '');
      this.el.title = hint ? `${r.reason} — ${hint}` : r.reason;
    }
  }
}
