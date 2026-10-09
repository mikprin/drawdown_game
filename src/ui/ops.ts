import {
  convertToInjector, convertToProducer, decommission, drillDays, drillWell, expandPad, fracWell, plugWell,
  repairWell, serviceWell, setLift, toggleShutIn,
} from '../game/actions';
import { ECON, LIFTS, OFFSHORE } from '../game/balance';
import { fmtBbl, fmtDays, fmtGas, fmtMoney, fmtNum, fmtPct, fmtRate, fmtRateShort } from '../game/format';
import { msg } from '../game/msg';
import { decomCost, platformOfField, rigUser, waterDepthClass } from '../game/platform';
import {
  depletion, fieldById, fieldWells, pressure, reserveEstimate, waterCut, wellById, wellNetPerDay,
} from '../game/reservoir';
import type { Field, GameState, LiftType, Well, WellStatus } from '../game/types';
import { t, type HelpId, type MsgKey } from '../i18n';
import { ActionButton, bar, h, setBar, setText, toggleClass } from './dom';
import { currentField, type Ctx } from './ctx';
import { help, term, type HelpSource } from './help';
import { confirmModal } from './modal';

const DEPTH: Record<number, MsgKey> = { 5: 'terrain.shallow', 6: 'terrain.midShelf', 7: 'terrain.outerShelf' };

/** Fields with a tab in the left panel: developed onshore fields, or every field that has a platform. */
function tabFields(s: GameState, sea: boolean): Field[] {
  if (sea) return s.platforms.map((p) => fieldById(s, p.fieldId));
  return s.fields.filter((f) => f.developed && !f.offshore);
}

/** A platform tab gets a red dot while its plant is choking the wells. */
export function platformAlert(s: GameState, fieldId: number): boolean {
  const p = platformOfField(s, fieldId);
  const pf = p ? s.flows.platforms[p.id] : undefined;
  return !!pf && pf.bottleneck !== 'none';
}

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
  private tabsTitle = h('span');
  private fieldName = h('span', { class: 'name' });
  private fieldSub = h('span', { class: 'sub' });
  private p90 = h('div', { class: 'v' });
  private p50 = h('div', { class: 'v' });
  private p10 = h('div', { class: 'v' });
  private kv: Record<string, HTMLElement> = {};
  private pressureBar = bar('good');
  private fieldBtns: ActionButton[] = [];
  private sea = false;
  private seaRows: HTMLElement;
  private seaKv: Record<string, HTMLElement> = {};
  private decomBtn: ActionButton;
  private stageBox = h('div');
  private stageLbl = h('span');
  private stageDays = h('span');
  private stageBar = bar('tall');
  private fieldBody: HTMLElement;
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
    const fid = () => currentField(ctx);
    const drill = new ActionButton(t('ops.drill'), () => drillWell(ctx.s, fid(), true), () => ctx.act((s) => drillWell(s, fid())),
      { cls: 'primary', help: () => term(fieldById(ctx.s, fid()).offshore ? 'drillOffshore' : 'drill') });
    const pad = new ActionButton(t('ops.expand'), () => expandPad(ctx.s, fid(), true), () => ctx.act((s) => expandPad(s, fid())),
      { help: () => term(fieldById(ctx.s, fid()).offshore ? 'wellbay' : 'pad') });
    this.fieldBtns = [drill, pad];
    const pid = () => platformOfField(ctx.s, fid())?.id ?? -1;
    this.decomBtn = new ActionButton(t('ops.decom'), () => decommission(ctx.s, pid(), true), () => {
      const f = fieldById(ctx.s, fid());
      const p = platformOfField(ctx.s, f.id);
      if (!p) return;
      confirmModal(t('decom.title'), t('decom.text', { field: f.name, cost: decomCost(ctx.s, p), days: OFFSHORE.decomDays }), t('decom.ok'),
        () => ctx.act((s) => decommission(s, p.id)));
    }, { cls: 'danger small', help: 'decom' });
    const seaKv = (k: MsgKey, key: string, id?: HelpId) => {
      this.seaKv[key] = h('span', { class: 'v' });
      const label = h('span', { class: 'k' }, t(k));
      return [id ? help(label, id) : label, this.seaKv[key]];
    };
    this.seaRows = h('div', null,
      h('div', { class: 'kv' }, ...seaKv('ops.platformNet', 'net', 'platformNet'), ...seaKv('ops.rig', 'rig', 'platformRig'), ...seaKv('ops.weather', 'weather', 'storm'), ...seaKv('ops.decomCost', 'decom', 'decom')),
      h('div', { class: 'btn-row' }, this.decomBtn.el));
    this.stageBox.append(h('div', { class: 'progress' }, h('div', { class: 'lbl' }, this.stageLbl, this.stageDays), this.stageBar));
    this.fieldBody = h('div', null,
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
          h('div', { class: 'btn-row' }, drill.el, pad.el));
    this.el.append(
      h('div', { class: 'section' }, h('div', { class: 'section-title' }, this.tabsTitle), this.tabs),
      h('div', { class: 'section' },
        h('div', { class: 'card rivets' },
          h('div', { class: 'title-row' }, this.fieldName, this.fieldSub),
          this.stageBox,
          this.fieldBody,
          this.seaRows,
        ),
      ),
      h('div', { class: 'section' }, h('div', { class: 'section-title' }, t('ops.wells'), this.wellsAside), this.wells),
      h('div', { class: 'section' }, this.detail),
    );
  }

  update(): void {
    const s = this.ctx.s;
    const ui = this.ctx.ui;
    const sea = ui.view === 'sea';
    this.sea = sea;
    const fields = tabFields(s, sea);
    if (sea) {
      if (!s.platforms.some((p) => p.id === ui.platform)) ui.platform = s.platforms[0]?.id ?? null;
    } else if (!fields.some((f) => f.id === ui.field)) ui.field = fields[0].id;
    const cur = currentField(this.ctx);

    const tk = `${sea}|` + fields.map((f) => `${f.id}${platformAlert(s, f.id) ? '!' : ''}`).join(',') + '|' + cur;
    if (tk !== this.tabsKey) {
      this.tabsKey = tk;
      setText(this.tabsTitle, t(sea ? 'ops.platforms' : 'ops.fields'));
      const pick = (f: Field) => () => (sea ? this.ctx.selectPlatform(platformOfField(s, f.id)!.id) : this.ctx.selectField(f.id));
      this.tabs.replaceChildren(...fields.map((f) =>
        h('button', { class: `tab ${f.id === cur ? 'on' : ''} ${sea && platformAlert(s, f.id) ? 'alert' : ''}`, onclick: pick(f) }, f.name)));
    }
    if (sea && ui.platform === null) {
      setText(this.fieldName, t('ops.noPlatforms'));
      setText(this.fieldSub, '');
      for (const el of [this.fieldBody, this.seaRows, this.stageBox]) el.style.display = 'none';
      this.wells.replaceChildren();
      this.wellsKey = '';
      this.updateDetail();
      return;
    }

    const f = fieldById(s, cur);
    const fw = fieldWells(s, f.id);
    const est = reserveEstimate(f);
    setText(this.fieldName, f.name);
    setText(this.fieldSub, f.offshore ? t(DEPTH[waterDepthClass(s, f)] ?? 'terrain.shallow') : t(f.id === 1 ? 'ops.home' : 'ops.satellite'));
    this.seaRows.style.display = sea ? '' : 'none';
    const plat = sea ? platformOfField(s, f.id) : undefined;
    const stage = f.devJob ? { key: 'ops.jackingUp' as MsgKey, job: f.devJob } : plat?.decom ? { key: 'ops.decomUnderway' as MsgKey, job: plat.decom } : null;
    this.stageBox.style.display = stage ? '' : 'none';
    this.fieldBody.style.display = stage ? 'none' : '';
    if (stage) {
      setText(this.stageLbl, t(stage.key));
      setText(this.stageDays, fmtDays(stage.job.daysLeft));
      setBar(this.stageBar, 1 - stage.job.daysLeft / stage.job.total);
    }
    if (plat) this.updateSea(s, f.id);
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
    this.fieldBtns[0].setLabel(fw.length === 0 ? t('ops.drill') : t('ops.drillDays', { days: drillDays(s, f.id) }));
    this.fieldBtns[1].setLabel(t(f.offshore ? 'ops.expandBay' : 'ops.expand'));
    for (const b of this.fieldBtns) b.update();

    this.updateWells(fw);
    this.updateDetail();
  }

  private updateSea(s: GameState, fieldId: number): void {
    const p = platformOfField(s, fieldId)!;
    const user = rigUser(s, fieldId);
    const storm = s.weather.storm > 0;
    setText(this.seaKv.rig, user
      ? t(storm ? 'ops.rigWaiting' : 'ops.rigBusy', { job: t(`job.${user.job!.kind}`), well: user.name, days: fmtDays(user.job!.daysLeft) })
      : t('ops.rigFree'));
    toggleClass(this.seaKv.rig, 'amber', !!user);
    setText(this.seaKv.weather, storm ? t('ops.storm', { days: fmtDays(s.weather.storm) }) : s.weather.warned ? t('ops.stormSoon', { days: fmtDays(s.weather.next) }) : t('ops.calm'));
    toggleClass(this.seaKv.weather, 'bad', storm || s.weather.warned);
    const pf = s.flows.platforms[p.id];
    const net = pf && !p.decom && !fieldById(s, fieldId).devJob ? pf.value - pf.costTotal : null;
    setText(this.seaKv.net, net === null ? '—' : (net >= 0 ? '+' : '') + fmtMoney(net));
    toggleClass(this.seaKv.net, 'good', net !== null && net > 0);
    toggleClass(this.seaKv.net, 'bad', net !== null && net < 0);
    setText(this.seaKv.decom, p.decom ? '—' : fmtMoney(decomCost(s, p)));
    this.decomBtn.el.style.display = p.decom ? 'none' : '';
    this.decomBtn.update();
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
    if (!w || w.fieldId !== currentField(this.ctx)) {
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
        btn(t('btn.frac', { days: ECON.fracDays }), () => fracWell(ctx.s, id, true), act((s) => fracWell(s, id)), this.sea ? 'fracOffshore' : 'frac', 'primary'),
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
