import { fmtDate } from '../game/format';
import { pendingObjectives } from '../game/objectives';
import type { LogEntry } from '../game/types';
import { t, tm } from '../i18n';
import { productionChart } from './charts';
import { h } from './dom';
import type { Ctx } from './ctx';
import { help } from './help';

export class BottomBar {
  private log = h('ul', { class: 'log' });
  private logTop: LogEntry | undefined;
  private logLen = -1;
  private chart = h('canvas');
  private chartLen = -1;
  private obj = h('ul', { class: 'objectives' });
  private objKey = '';

  constructor(root: HTMLElement, private ctx: Ctx) {
    root.append(
      h('div', null, h('div', { class: 'section-title' }, t('bottom.log')), this.log),
      h('div', null,
        h('div', { class: 'section-title' }, help(h('span', null, t('bottom.prod')), 'decline'),
          h('span', { class: 'aside legend' },
            h('span', null, h('i', { style: 'background:#e8a23a' }), t('bottom.oil')),
            h('span', null, h('i', { style: 'background:#4fa3c7' }), t('bottom.water')))),
        h('div', { class: 'chart-wrap' }, this.chart)),
      h('div', null, h('div', { class: 'section-title' }, t('bottom.obj')), this.obj),
    );
    window.addEventListener('resize', () => { this.chartLen = -1; });
  }

  update(): void {
    const s = this.ctx.s;
    if (s.log[0] !== this.logTop || s.log.length !== this.logLen) {
      this.logTop = s.log[0];
      this.logLen = s.log.length;
      this.log.replaceChildren(...s.log.slice(0, 30).map((e) =>
        h('li', { class: e.kind }, h('span', { class: 'd' }, fmtDate(e.day)), tm(e.msg))));
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
      this.obj.replaceChildren(...(pend.length ? pend.map((o) => h('li', null, t(o.key))) : [h('li', null, t('obj.allDone'))]));
    }
  }
}
