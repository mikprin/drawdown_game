import { fmtDate } from '../game/format';
import { pendingObjectives } from '../game/objectives';
import { productionChart } from './charts';
import { h } from './dom';
import type { Ctx } from './ctx';

export class BottomBar {
  private log = h('ul', { class: 'log' });
  private logKey = '';
  private chart = h('canvas');
  private chartLen = -1;
  private obj = h('ul', { class: 'objectives' });
  private objKey = '';

  constructor(root: HTMLElement, private ctx: Ctx) {
    root.append(
      h('div', null, h('div', { class: 'section-title' }, 'Field log'), this.log),
      h('div', null,
        h('div', { class: 'section-title' }, 'Production',
          h('span', { class: 'aside legend' }, h('span', null, h('i', { style: 'background:#e8a23a' }), 'oil'), h('span', null, h('i', { style: 'background:#4fa3c7' }), 'water'))),
        h('div', { class: 'chart-wrap' }, this.chart)),
      h('div', null, h('div', { class: 'section-title' }, 'Objectives'), this.obj),
    );
    window.addEventListener('resize', () => { this.chartLen = -1; });
  }

  update(): void {
    const s = this.ctx.s;
    const lk = `${s.log.length}:${s.log[0]?.day}:${s.log[0]?.text}`;
    if (lk !== this.logKey) {
      this.logKey = lk;
      this.log.replaceChildren(...s.log.slice(0, 30).map((e) =>
        h('li', { class: e.kind }, h('span', { class: 'd' }, fmtDate(e.day)), e.text)));
    }
    const n = s.history.oil.length;
    if (n !== this.chartLen) {
      this.chartLen = n;
      productionChart(this.chart, s.history.oil.slice(-365), s.history.water.slice(-365));
    }
    const pend = pendingObjectives(s, 4);
    const ok = pend.map((o) => o.id).join(',');
    if (ok !== this.objKey) {
      this.objKey = ok;
      this.obj.replaceChildren(...(pend.length ? pend.map((o) => h('li', null, o.text)) : [h('li', null, 'All layer-1 goals met. Offshore awaits.')]));
    }
  }
}
