import {
  convertToInjector, convertToProducer, drillWell, expandPad, fracWell, plugWell,
  repairWell, serviceWell, setLift, toggleShutIn,
} from '../game/actions';
import { ECON, LIFTS } from '../game/balance';
import { fmtBbl, fmtDays, fmtGas, fmtMoney, fmtNum, fmtPct, fmtRate, fmtRateShort } from '../game/format';
import { msg } from '../game/msg';
import {
  depletion, fieldById, fieldWells, pressure, reserveEstimate, waterCut, wellById, wellNetPerDay,
} from '../game/reservoir';
import type { LiftType, Well, WellStatus } from '../game/types';
import { t, type HelpId, type MsgKey } from '../i18n';
import { ActionButton, bar, h, setBar, setText, toggleClass } from './dom';
import type { Ctx } from './ctx';
import { help, term, type HelpSource } from './help';
import { confirmModal } from './modal';

const LIFT_ORDER: LiftType[] = ['flowing', 'rodpump', 'gaslift', 'esp'];
const STATUS_HELP: Partial<Record<WellStatus, HelpId>> = { failed: 'failed', shutin: 'shutin', injector: 'injector' };

function statusOf(w: Well): { cls: string; text: string; badge: string } {
  if (w.job) return { cls: 'job', text: t(`job.${w.job.kind}`), badge: 'amber' };
  if (w.status === 'failed') return { cls: 'failed', text: t('status.failed'), badge: 'bad' };
  if (w.status === 'shutin') return { cls: 'shutin', text: t('status.shutin'), badge: '' };
  if (w.status === 'injector') return { cls: 'injector', text: t('status.injector'), badge: 'water' };
  return { cls: 'active', text: t('status.active'), badge: 'good' };
}

/** Card for a lift type: what it is and how much it lifts. */
function liftHelp(lt: LiftType) {
  return () => ({ title: t(`lift.${lt}.name`), body: `${t(`lift.${lt}.desc`)} ${t('lift.max', { cap: LIFTS[lt].capacity })}` });
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
    const kvRow = (k: MsgKey, key: string, id?: HelpId) => {
      this.kv[key] = h('span', { class: 'v' });
      const label = h('span', { class: 'k' }, t(k));
      return [id ? help(label, id) : label, this.kv[key]];
    };
    const drill = new ActionButton(t('ops.drill'), () => drillWell(ctx.s, ctx.ui.field, true), () => ctx.act((s) => drillWell(s, ctx.ui.field)), { cls: 'primary', help: 'drill' });
    const pad = new ActionButton(t('ops.expand'), () => expandPad(ctx.s, ctx.ui.field, true), () => ctx.act((s) => expandPad(s, ctx.ui.field)), { help: 'pad' });
    this.fieldBtns = [drill, pad];
    this.el.append(
      h('div', { class: 'section' }, h('div', { class: 'section-title' }, t('ops.fields')), this.tabs),
      h('div', { class: 'section' },
        h('div', { class: 'card rivets' },
          h('div', { class: 'title-row' }, this.fieldName, this.fieldSub),
          help(h('div', { class: 'reserve' },
            h('div', null, h('div', { class: 'k' }, t('ops.p90')), this.p90),
            h('div', { class: 'p50' }, h('div', { class: 'k' }, t('ops.p50')), this.p50),
            h('div', null, h('div', { class: 'k' }, t('ops.p10')), this.p10)), 'eur', false),
          h('div', { class: 'kv' },
            ...kvRow('ops.produced', 'np'),
            ...kvRow('ops.remaining', 'rem', 'eur'),
            ...kvRow('ops.wc', 'wc', 'wc'),
            ...kvRow('ops.flood', 'flood', 'flood'),
            ...kvRow('ops.slots', 'slots', 'pad')),
          h('div', { class: 'kv' }, ...kvRow('ops.pressure', 'pressure', 'pressure')),
          this.pressureBar,
          h('div', { class: 'btn-row' }, drill.el, pad.el),
        ),
      ),
      h('div', { class: 'section' }, h('div', { class: 'section-title' }, t('ops.wells'), this.wellsAside), this.wells),
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
    setText(this.fieldSub, t(f.id === 1 ? 'ops.home' : 'ops.satellite'));
    setText(this.p90, fmtNum(est.p90));
    setText(this.p50, fmtNum(est.p50));
    setText(this.p10, fmtNum(est.p10));
    setText(this.kv.np, fmtBbl(f.np));
    setText(this.kv.rem, fmtBbl(Math.max(0, est.p50 - f.np)));
    let liq = 0, wat = 0;
    for (const w of fw) { liq += s.flows.wells[w.id]?.liquid ?? 0; wat += s.flows.wells[w.id]?.water ?? 0; }
    const sample = fw.find((w) => w.status !== 'injector');
    setText(this.kv.wc, liq > 0 ? fmtPct(wat / liq) : sample ? fmtPct(waterCut(f, sample)) : '—');
    setText(this.kv.flood, f.flood > 0.01 ? fmtPct(f.flood) : t('ops.none'));
    setText(this.kv.slots, `${fw.length} / ${f.slots}`);
    const p = pressure(f);
    setText(this.kv.pressure, t('ops.depleted', { p, d: depletion(f) }));
    setBar(this.pressureBar, p);
    this.fieldBtns[0].setLabel(fw.length === 0 ? t('ops.drill') : t('ops.drillDays', { days: ECON.drillDays }));
    for (const b of this.fieldBtns) b.update();

    this.updateWells(fw);
    this.updateDetail();
  }

  private updateWells(fw: Well[]): void {
    const s = this.ctx.s;
    const key = fw.map((w) => `${w.id}:${w.status}:${w.lift}:${w.job?.kind ?? ''}`).join(',') + '|' + this.ctx.ui.well;
    const producing = fw.filter((w) => w.status === 'active' && !w.job).length;
    setText(this.wellsAside, t('ops.producing', { n: producing }));
    if (key !== this.wellsKey) {
      this.wellsKey = key;
      this.rows.clear();
      const rows = fw.map((w) => {
        const st = statusOf(w);
        const isInj = w.status === 'injector';
        const r: Row = {
          dot: h('span', { class: `status-dot ${st.cls}`, title: st.text }),
          rate: h('span', { class: 'rate' }),
          wc: h('span', { class: 'wc' }),
          cond: help(bar('cond'), () => ({ ...term('condition'), note: fmtPct(wellById(this.ctx.s, w.id)?.condition ?? 0) }), false),
          el: h('div'),
        };
        r.el = h('div', { class: `well-row ${w.id === this.ctx.ui.well ? 'sel' : ''}`, onclick: () => this.ctx.selectWell(w.id) },
          r.dot, h('span', { class: 'nm' }, w.name),
          help(h('span', { class: 'lift' }, isInj ? t('ops.injShort') : t(`lift.${w.lift}.short`)), isInj ? 'injector' : liftHelp(w.lift), false),
          r.rate, help(r.wc, 'wc', false), r.cond);
        this.rows.set(w.id, r);
        return r.el;
      });
      this.wells.replaceChildren(...(rows.length ? rows : [h('div', { class: 'empty' }, t('ops.noWells'))]));
    }
    for (const w of fw) {
      const r = this.rows.get(w.id)!;
      const wf = s.flows.wells[w.id];
      if (w.status === 'injector') {
        setText(r.rate, wf ? fmtRateShort(wf.inj) : '0');
        setText(r.wc, t('ops.inj'));
      } else {
        setText(r.rate, wf ? fmtRateShort(wf.oil) : '—');
        setText(r.wc, wf ? fmtPct(wf.wc) : '—');
      }
      setBar(r.cond, w.condition);
      toggleClass(r.cond, 'warn', w.condition < 0.4);
      toggleClass(r.cond, 'good', w.condition >= 0.4);
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
        this.detail.replaceChildren(h('div', { class: 'empty' }, t('ops.selectWell')));
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
    const kv = (label: MsgKey, key: string, cls = '', helpId?: HelpId) => {
      v[key] = h('span', { class: `v ${cls}` });
      const k = h('span', { class: 'k' }, t(label));
      return [helpId ? help(k, helpId) : k, v[key]];
    };
    const btns: ActionButton[] = [];
    const btn = (label: string, check: () => ReturnType<typeof fracWell>, run: () => void, src: HelpSource, cls = '') => {
      const b = new ActionButton(label, check, run, { cls, help: src });
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
    const badge = h('span', { class: `badge ${st.badge} right` }, st.text);
    const statusHelp = w.job ? null : STATUS_HELP[w.status];
    const children: (Node | null)[] = [
      h('div', { class: 'title-row' }, h('span', { class: 'name' }, w.name), statusHelp ? help(badge, statusHelp, false) : badge),
      w.job ? progress : null,
      h('div', { class: 'kv' },
        ...(isInj
          ? [...kv('well.injection', 'inj', 'water', 'injector')]
          : [
              ...kv('well.reservoir', 'res', '', 'deliverability'),
              ...kv('well.liftCap', 'cap', '', 'liftCap'),
              ...kv('well.liquid', 'liq'),
              ...kv('well.oil', 'oil', 'oil'),
              ...kv('well.water', 'wat', 'water'),
              ...kv('well.wc', 'wc', 'water', 'wc'),
              ...kv('well.gas', 'gas', 'gas', 'gas'),
              ...kv('well.net', 'net', '', 'wellNet'),
              ...kv('well.frac', 'frac', '', 'frac'),
            ]),
        ...kv('well.np', 'np'),
        ...kv('well.cond', 'cond', '', 'condition')),
      condBar,
    ];

    if (!isInj && w.status !== 'failed') {
      const liftGrid = h('div', { class: 'lift-grid' });
      for (const lt of LIFT_ORDER) {
        const installed = w.lift === lt;
        const b = new ActionButton(t(`lift.${lt}.name`),
          () => (installed ? { ok: false, reason: msg('reason.installed') } : setLift(ctx.s, id, lt, true)),
          act((s) => setLift(s, id, lt)), { cls: `small ${installed ? 'on' : ''}`, help: liftHelp(lt) });
        btns.push(b);
        liftGrid.append(b.el);
      }
      children.push(h('div', { class: 'section-title', style: 'margin-top:10px' }, help(h('span', null, t('well.lift')), 'lift')), liftGrid);
    }

    const actions = h('div', { class: 'btn-grid' });
    if (w.status === 'failed') {
      actions.append(btn(t('btn.repair'), () => repairWell(ctx.s, id, true), act((s) => repairWell(s, id)), 'repair', 'primary'));
    } else if (isInj) {
      actions.append(btn(t('btn.toProducer'), () => convertToProducer(ctx.s, id, true), act((s) => convertToProducer(s, id)), 'toProducer'));
    } else {
      actions.append(
        btn(t('btn.frac', { days: ECON.fracDays }), () => fracWell(ctx.s, id, true), act((s) => fracWell(s, id)), 'frac', 'primary'),
        btn(t('btn.service'), () => serviceWell(ctx.s, id, true), act((s) => serviceWell(s, id)), 'service'),
        btn(t(w.status === 'shutin' ? 'btn.reopen' : 'btn.shutIn'), () => toggleShutIn(ctx.s, id, true), act((s) => toggleShutIn(s, id)), 'shutin'),
        btn(t('btn.toInjector'), () => convertToInjector(ctx.s, id, true), act((s) => convertToInjector(s, id)), 'toInjector'),
      );
    }
    const plug = new ActionButton(t('btn.plug'), () => plugWell(ctx.s, id, true), () =>
      confirmModal(t('plug.title'), t('plug.text', { well: w.name }), t('plug.ok'), () => ctx.act((s) => plugWell(s, id))),
      { cls: 'danger small', help: 'plug' });
    btns.push(plug);
    actions.append(plug.el);
    children.push(h('div', { class: 'section-title', style: 'margin-top:10px' }, t('well.actions')), actions);

    this.detail.replaceChildren(h('div', { class: 'card rivets' }, ...children));

    this.detailUpdate = () => {
      const s = ctx.s;
      const cur = wellById(s, id);
      if (!cur) return;
      const wf = s.flows.wells[id];
      if (cur.job) {
        setText(progLbl, t(`job.${cur.job.kind}`));
        setText(progDays, fmtDays(cur.job.daysLeft));
        setBar(progBar, 1 - cur.job.daysLeft / cur.job.total);
      }
      if (isInj) {
        setText(v.inj, fmtRate(wf ? wf.inj : 0));
      } else {
        setText(v.res, wf ? fmtRate(wf.reservoir) : '—');
        setText(v.cap, wf ? fmtRate(wf.liftCap) : '—');
        toggleClass(v.cap, 'amber', !!wf && wf.reservoir > wf.liftCap * 1.02);
        setText(v.liq, wf ? fmtRate(wf.liquid) : '—');
        setText(v.oil, wf ? fmtRate(wf.oil) : '—');
        setText(v.wat, wf ? fmtRate(wf.water) : '—');
        setText(v.wc, wf ? fmtPct(wf.wc, 1) : '—');
        setText(v.gas, wf ? fmtGas(wf.gas) : '—');
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
