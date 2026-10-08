import {
  convertToInjector, convertToProducer, drillWell, expandPad, fracWell, plugWell,
  repairWell, serviceWell, setLift, toggleShutIn,
} from '../game/actions';
import { ECON, LIFTS } from '../game/balance';
import { fmtBbl, fmtDays, fmtMoney, fmtPct, fmtRate } from '../game/format';
import {
  depletion, fieldById, fieldWells, pressure, reserveEstimate, waterCut, wellById, wellNetPerDay,
} from '../game/reservoir';
import type { LiftType, Well } from '../game/types';
import { ActionButton, bar, h, setBar, setText, toggleClass } from './dom';
import type { Ctx } from './ctx';
import { confirmModal } from './modal';

const LIFT_ORDER: LiftType[] = ['flowing', 'rodpump', 'gaslift', 'esp'];
const JOB_LABEL: Record<string, string> = { drill: 'Drilling', lift: 'Installing lift', frac: 'Frac job', convert: 'Converting', repair: 'Repairing' };

function statusOf(w: Well): { cls: string; text: string; badge: string } {
  if (w.job) return { cls: 'job', text: JOB_LABEL[w.job.kind], badge: 'amber' };
  if (w.status === 'failed') return { cls: 'failed', text: 'Failed', badge: 'bad' };
  if (w.status === 'shutin') return { cls: 'shutin', text: 'Shut in', badge: '' };
  if (w.status === 'injector') return { cls: 'injector', text: 'Injector', badge: 'water' };
  return { cls: 'active', text: 'Producing', badge: 'good' };
}

interface Row {
  el: HTMLElement;
  rate: HTMLElement;
  wc: HTMLElement;
  cond: HTMLElement;
  dot: HTMLElement;
}

export class OpsPanel {
  readonly el = h('div');
  private tabs = h('div', { class: 'tabs' });
  private tabsKey = '';
  private fieldName = h('span', { class: 'name' });
  private fieldSub = h('span', { class: 'sub' });
  private p90 = h('div', { class: 'v' });
  private p50 = h('div', { class: 'v' });
  private p10 = h('div', { class: 'v' });
  private kv: Record<string, HTMLElement> = {};
  private pressureBar = bar('good');
  private fieldBtns: ActionButton[] = [];
  private wells = h('div', { class: 'wells' });
  private wellsKey = '';
  private rows = new Map<number, Row>();
  private wellsAside = h('span', { class: 'aside' });
  private detail = h('div');
  private detailKey = '';
  private detailUpdate: (() => void) | null = null;

  constructor(private ctx: Ctx) {
    const kvRow = (k: string, key: string) => {
      this.kv[key] = h('span', { class: 'v' });
      return [h('span', { class: 'k' }, k), this.kv[key]];
    };
    const drill = new ActionButton('Drill well', () => drillWell(ctx.s, ctx.ui.field, true), () => ctx.act((s) => drillWell(s, ctx.ui.field)), { cls: 'primary' });
    const pad = new ActionButton('Expand pad', () => expandPad(ctx.s, ctx.ui.field, true), () => ctx.act((s) => expandPad(s, ctx.ui.field)));
    this.fieldBtns = [drill, pad];
    this.el.append(
      h('div', { class: 'section' }, h('div', { class: 'section-title' }, 'Fields'), this.tabs),
      h('div', { class: 'section' },
        h('div', { class: 'card rivets' },
          h('div', { class: 'title-row' }, this.fieldName, this.fieldSub),
          h('div', { class: 'reserve', title: 'Estimated ultimate recovery. P90 = conservative, P10 = optimistic. Narrows as the field produces.' },
            h('div', null, h('div', { class: 'k' }, 'P90'), this.p90),
            h('div', { class: 'p50' }, h('div', { class: 'k' }, 'P50 EUR'), this.p50),
            h('div', null, h('div', { class: 'k' }, 'P10'), this.p10)),
          h('div', { class: 'kv' },
            ...kvRow('Produced', 'np'),
            ...kvRow('Remaining (P50)', 'rem'),
            ...kvRow('Water cut', 'wc'),
            ...kvRow('Waterflood support', 'flood'),
            ...kvRow('Wells / slots', 'slots')),
          h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Reservoir pressure'), this.kv.pressure = h('span', { class: 'v' })),
          this.pressureBar,
          h('div', { class: 'btn-row' }, drill.el, pad.el),
        ),
      ),
      h('div', { class: 'section' }, h('div', { class: 'section-title' }, 'Wells', this.wellsAside), this.wells),
      h('div', { class: 'section' }, this.detail),
    );
  }

  update(): void {
    const s = this.ctx.s;
    const ui = this.ctx.ui;
    const fields = s.fields.filter((f) => f.developed);
    if (!fields.some((f) => f.id === ui.field)) ui.field = fields[0].id;

    const tk = fields.map((f) => f.id).join(',') + '|' + ui.field;
    if (tk !== this.tabsKey) {
      this.tabsKey = tk;
      this.tabs.replaceChildren(...fields.map((f) =>
        h('button', { class: `tab ${f.id === ui.field ? 'on' : ''}`, onclick: () => this.ctx.selectField(f.id) }, f.name)));
    }

    const f = fieldById(s, ui.field);
    const fw = fieldWells(s, f.id);
    const est = reserveEstimate(f);
    setText(this.fieldName, f.name);
    setText(this.fieldSub, f.id === 1 ? 'home field' : 'satellite');
    setText(this.p90, fmtBbl(est.p90).replace(' bbl', ''));
    setText(this.p50, fmtBbl(est.p50).replace(' bbl', ''));
    setText(this.p10, fmtBbl(est.p10).replace(' bbl', ''));
    setText(this.kv.np, fmtBbl(f.np));
    setText(this.kv.rem, fmtBbl(Math.max(0, est.p50 - f.np)));
    let liq = 0, wat = 0;
    for (const w of fw) { liq += s.flows.wells[w.id]?.liquid ?? 0; wat += s.flows.wells[w.id]?.water ?? 0; }
    const sample = fw.find((w) => w.status !== 'injector');
    setText(this.kv.wc, liq > 0 ? fmtPct(wat / liq) : sample ? fmtPct(waterCut(f, sample)) : '—');
    setText(this.kv.flood, f.flood > 0.01 ? fmtPct(f.flood) : 'none');
    setText(this.kv.slots, `${fw.length} / ${f.slots}`);
    const p = pressure(f);
    setText(this.kv.pressure, `${fmtPct(p)} · ${fmtPct(depletion(f))} depleted`);
    setBar(this.pressureBar, p);
    this.fieldBtns[0].setLabel(fw.length === 0 ? 'Drill well' : `Drill well · ${fmtDays(ECON.drillDays)}`);
    for (const b of this.fieldBtns) b.update();

    this.updateWells(fw);
    this.updateDetail();
  }

  private updateWells(fw: Well[]): void {
    const s = this.ctx.s;
    const key = fw.map((w) => `${w.id}:${w.status}:${w.lift}:${w.job?.kind ?? ''}`).join(',') + '|' + this.ctx.ui.well;
    const producing = fw.filter((w) => w.status === 'active' && !w.job).length;
    setText(this.wellsAside, `${producing} producing`);
    if (key !== this.wellsKey) {
      this.wellsKey = key;
      this.rows.clear();
      const rows = fw.map((w) => {
        const st = statusOf(w);
        const r: Row = {
          dot: h('span', { class: `status-dot ${st.cls}`, title: st.text }),
          rate: h('span', { class: 'rate' }),
          wc: h('span', { class: 'wc' }),
          cond: bar('cond'),
          el: h('div'),
        };
        r.el = h('div', { class: `well-row ${w.id === this.ctx.ui.well ? 'sel' : ''}`, onclick: () => this.ctx.selectWell(w.id) },
          r.dot, h('span', { class: 'nm' }, w.name),
          h('span', { class: 'lift' }, w.status === 'injector' ? 'INJ' : LIFTS[w.lift].short),
          r.rate, r.wc, r.cond);
        this.rows.set(w.id, r);
        return r.el;
      });
      this.wells.replaceChildren(...(rows.length ? rows : [h('div', { class: 'empty' }, 'No wells yet.')]));
    }
    for (const w of fw) {
      const r = this.rows.get(w.id)!;
      const wf = s.flows.wells[w.id];
      if (w.status === 'injector') {
        setText(r.rate, wf ? fmtRate(wf.inj).replace(' bbl/d', '') : '0');
        setText(r.wc, 'inj');
      } else {
        setText(r.rate, wf ? fmtRate(wf.oil).replace(' bbl/d', '') + ' b/d' : '—');
        setText(r.wc, wf ? fmtPct(wf.wc) : '—');
      }
      setBar(r.cond, w.condition);
      toggleClass(r.cond, 'warn', w.condition < 0.4);
      toggleClass(r.cond, 'good', w.condition >= 0.4);
      r.cond.title = `Condition ${fmtPct(w.condition)}`;
    }
  }

  private updateDetail(): void {
    const s = this.ctx.s;
    const id = this.ctx.ui.well;
    const w = id !== null ? wellById(s, id) : undefined;
    if (!w || w.fieldId !== this.ctx.ui.field) {
      if (this.detailKey !== 'none') {
        this.detailKey = 'none';
        this.detailUpdate = null;
        this.detail.replaceChildren(h('div', { class: 'empty' }, 'Select a well in the list or click one on the site.'));
      }
      return;
    }
    const key = `${w.id}:${w.status}:${w.lift}:${w.job?.kind ?? ''}`;
    if (key !== this.detailKey) {
      this.detailKey = key;
      this.buildDetail(w);
    }
    this.detailUpdate?.();
  }

  private buildDetail(w: Well): void {
    const ctx = this.ctx;
    const id = w.id;
    const st = statusOf(w);
    const v: Record<string, HTMLElement> = {};
    const kv = (label: string, key: string, cls = '') => {
      v[key] = h('span', { class: `v ${cls}` });
      return [h('span', { class: 'k' }, label), v[key]];
    };
    const btns: ActionButton[] = [];
    const btn = (label: string, check: () => ReturnType<typeof fracWell>, run: () => void, cls = '') => {
      const b = new ActionButton(label, check, run, { cls });
      btns.push(b);
      return b.el;
    };
    const act = (fn: (s: typeof ctx.s) => unknown) => () => ctx.act(fn);

    const progress = h('div', { class: 'progress' });
    const progLbl = h('span');
    const progDays = h('span');
    const progBar = bar('tall');
    if (w.job) progress.append(h('div', { class: 'lbl' }, progLbl, progDays), progBar);

    const condBar = bar('tall');
    const isInj = w.status === 'injector';
    const children: (Node | null)[] = [
      h('div', { class: 'title-row' }, h('span', { class: 'name' }, w.name), h('span', { class: `badge ${st.badge} right` }, st.text)),
      w.job ? progress : null,
      h('div', { class: 'kv' },
        ...(isInj
          ? [...kv('Injection', 'inj', 'water')]
          : [
              ...kv('Reservoir can give', 'res'),
              ...kv('Lift capacity', 'cap'),
              ...kv('Liquid lifted', 'liq'),
              ...kv('Oil', 'oil', 'oil'),
              ...kv('Water', 'wat', 'water'),
              ...kv('Water cut', 'wc', 'water'),
              ...kv('Gas', 'gas', 'gas'),
              ...kv('Net / day', 'net'),
              ...kv('Frac stages', 'frac'),
            ]),
        ...kv('Cumulative oil', 'np'),
        ...kv('Condition', 'cond')),
      condBar,
    ];

    if (!isInj && w.status !== 'failed') {
      const liftGrid = h('div', { class: 'lift-grid' });
      for (const lt of LIFT_ORDER) {
        const def = LIFTS[lt];
        const installed = w.lift === lt;
        const b = new ActionButton(def.name, () => (installed ? { ok: false, reason: 'Installed' } : setLift(ctx.s, id, lt, true)),
          act((s) => setLift(s, id, lt)), { cls: `small ${installed ? 'on' : ''}`, hint: `${def.desc} Max ${def.capacity} bbl/d liquid.` });
        btns.push(b);
        liftGrid.append(b.el);
      }
      children.push(h('div', { class: 'section-title', style: 'margin-top:10px' }, 'Artificial lift'), liftGrid);
    }

    const actions = h('div', { class: 'btn-grid' });
    if (w.status === 'failed') {
      actions.append(btn('Repair', () => repairWell(ctx.s, id, true), act((s) => repairWell(s, id)), 'primary'));
    } else if (isInj) {
      actions.append(btn('To producer', () => convertToProducer(ctx.s, id, true), act((s) => convertToProducer(s, id))));
    } else {
      actions.append(
        btn(`Frac · ${ECON.fracDays}d`, () => fracWell(ctx.s, id, true), act((s) => fracWell(s, id)), 'primary'),
        btn('Service', () => serviceWell(ctx.s, id, true), act((s) => serviceWell(s, id))),
        btn(w.status === 'shutin' ? 'Reopen' : 'Shut in', () => toggleShutIn(ctx.s, id, true), act((s) => toggleShutIn(s, id))),
        btn('To injector', () => convertToInjector(ctx.s, id, true), act((s) => convertToInjector(s, id))),
      );
    }
    const plug = new ActionButton('Plug & abandon', () => plugWell(ctx.s, id, true), () =>
      confirmModal('Plug & abandon', `Permanently plug ${w.name} and free its slot?`, 'Plug it', () => ctx.act((s) => plugWell(s, id))),
      { cls: 'danger small' });
    btns.push(plug);
    actions.append(plug.el);
    children.push(h('div', { class: 'section-title', style: 'margin-top:10px' }, 'Actions'), actions);

    this.detail.replaceChildren(h('div', { class: 'card rivets' }, ...children));

    this.detailUpdate = () => {
      const s = ctx.s;
      const cur = wellById(s, id);
      if (!cur) return;
      const wf = s.flows.wells[id];
      if (cur.job) {
        setText(progLbl, JOB_LABEL[cur.job.kind]);
        setText(progDays, fmtDays(cur.job.daysLeft));
        setBar(progBar, 1 - cur.job.daysLeft / cur.job.total);
      }
      if (isInj) {
        setText(v.inj, wf ? fmtRate(wf.inj) : '0 bbl/d');
      } else {
        setText(v.res, wf ? fmtRate(wf.reservoir) : '—');
        setText(v.cap, wf ? fmtRate(wf.liftCap) : '—');
        toggleClass(v.cap, 'amber', !!wf && wf.reservoir > wf.liftCap * 1.02);
        setText(v.liq, wf ? fmtRate(wf.liquid) : '—');
        setText(v.oil, wf ? fmtRate(wf.oil) : '—');
        setText(v.wat, wf ? fmtRate(wf.water) : '—');
        setText(v.wc, wf ? fmtPct(wf.wc, 1) : '—');
        setText(v.gas, wf ? `${wf.gas.toFixed(0)} mcf/d` : '—');
        const net = wellNetPerDay(s, cur);
        setText(v.net, wf ? (net >= 0 ? '+' : '') + fmtMoney(net) : '—');
        toggleClass(v.net, 'good', net > 0);
        toggleClass(v.net, 'bad', net < 0 && !!wf);
        setText(v.frac, `${cur.fracCount} / ${ECON.fracMax}${cur.stim > 0.02 ? ` · +${fmtPct(cur.stim)}` : ''}`);
      }
      setText(v.np, fmtBbl(cur.np));
      setText(v.cond, fmtPct(cur.condition));
      setBar(condBar, cur.condition);
      toggleClass(condBar, 'warn', cur.condition < 0.4);
      toggleClass(condBar, 'good', cur.condition >= 0.4);
      for (const b of btns) b.update();
    };
  }
}
