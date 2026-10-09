import { buyModule, charterTanker, expandDeck, moduleLockReason, releaseTanker } from '../game/actions';
import { DECK, OFFSHORE } from '../game/balance';
import { fmtDays, fmtGasNum, fmtMoney, fmtNum, fmtPct } from '../game/format';
import { deckArea, deckUsed, moduleNextArea, moduleNextValue, platformById } from '../game/platform';
import type { ModuleId, Platform, PlatformFlows, Tanker } from '../game/types';
import { t, type MsgKey } from '../i18n';
import { ActionButton, bar, h, setBar, setText, toggleClass } from './dom';
import type { Ctx } from './ctx';
import { help, term, type HelpSource, type HelpView } from './help';

interface Gauge {
  val: HTMLElement;
  bar: HTMLElement;
}

const modHelp = (id: ModuleId): HelpView => ({ title: t(`mod.${id}.name`), body: t(`mod.${id}.desc`) });

function tankerText(tk: Tanker): string {
  switch (tk.state) {
    case 'moored': return t('tanker.moored', { v: tk.cargo, cap: OFFSHORE.tankerCargo });
    case 'queued': return t('tanker.queued');
    case 'outbound': return t('tanker.outbound', { days: fmtDays(tk.daysLeft) });
    case 'port': return t('tanker.port');
    case 'inbound': return t('tanker.inbound', { days: fmtDays(tk.daysLeft) });
  }
}

/** Right-panel cascade of the selected platform: deck modules, tankers, water, gas and power. */
export class PlatformCascade {
  readonly el = h('div', { class: 'section' });
  private buttons: ActionButton[] = [];
  private nodes: Record<string, HTMLElement> = {};
  private g: Record<string, Gauge> = {};
  private deckVal = h('span', { class: 'aside' });
  private deckBar = bar('');
  private tankerList = h('div', { class: 'tankers' });
  private tankerKey = '';
  private tankerRows: HTMLElement[] = [];
  private power = h('div', { class: 'muted small-note' });

  constructor(ctx: Ctx) {
    const pid = () => ctx.ui.platform ?? -1;
    const gauge = (key: string, kind = '') => {
      this.g[key] = { val: h('span', { class: 'val' }), bar: bar(kind) };
      return this.g[key];
    };
    const mod = (id: ModuleId, labelKey: MsgKey) => {
      const label = t(labelKey);
      const fmtValue = id === 'turbine' || id === 'gasInj' ? fmtGasNum : fmtNum;
      const b = new ActionButton(label, () => buyModule(ctx.s, pid(), id, true), () => ctx.act((s) => buyModule(s, pid(), id)), {
        cls: 'small',
        help: () => {
          const p = platformById(ctx.s, pid());
          const extra = p ? moduleNextArea(p, id) : null;
          const lock = moduleLockReason(ctx.s, pid(), id);
          return extra !== null && !lock && p
            ? { ...modHelp(id), note: t('deck.takes', { n: extra, free: deckArea(p) - deckUsed(p) }), noteCls: 'amber' }
            : modHelp(id);
        },
        labelFn: () => {
          const p = platformById(ctx.s, pid());
          const nv = p ? moduleNextValue(p, id) : null;
          return nv === null ? `${label} · ${t('plant.max')}` : `${label} → ${fmtValue(nv)}`;
        },
      });
      this.buttons.push(b);
      return b.el;
    };
    const withNote = (base: () => HelpView, note: () => string | null): HelpSource => () => {
      const n = note();
      return n ? { ...base(), note: n, noteCls: 'bad' } : base();
    };
    const pf = () => ctx.s.flows.platforms[pid()];
    const bnNote = (k: string, key: MsgKey = 'plant.bottleneckNote') => () =>
      (pf()?.bottleneck === k ? `${t(key)} ${t('help.bottleneck.b')}` : null);
    const node = (key: string, nameKey: MsgKey, src: HelpSource, gk: string, kind: string, ...extra: (Node | null)[]) => {
      const gg = gauge(gk, kind);
      this.nodes[key] = h('div', { class: 'node', 'data-bn': t('plant.bottleneck'), 'data-ll': t('plant.liftLimited') },
        h('div', { class: 'node-head' }, help(h('span', { class: 'nm' }, t(nameKey)), src), gg.val),
        gg.bar, ...extra);
      return this.nodes[key];
    };
    const sub = (labelKey: MsgKey, src: HelpSource, gk: string, kind: string, ...btns: Node[]) => {
      const gg = gauge(gk, kind);
      return h('div', { class: 'sub-node' },
        h('div', { class: 'row' }, help(h('span', { class: 'muted' }, t(labelKey)), src), gg.val), gg.bar,
        btns.length ? h('div', { class: 'btn-row' }, ...btns) : null);
    };
    const arrow = () => h('div', { class: 'flow-arrow' });
    const liftNote = () => {
      const n = pf()?.liftLimitedWells ?? 0;
      return n > 0 ? `${t('plant.liftLimitedNote', { n })} ${t('help.liftLimited.b')}` : null;
    };

    const charter = new ActionButton(t('sea.charter'), () => charterTanker(ctx.s, pid(), true), () => ctx.act((s) => charterTanker(s, pid())), { cls: 'small', help: 'charter' });
    const release = new ActionButton(t('sea.release'), () => releaseTanker(ctx.s, pid(), true), () => ctx.act((s) => releaseTanker(s, pid())), { cls: 'small ghost', help: 'release', showCost: false });
    const deckBtn = new ActionButton(t('deck.expand'), () => expandDeck(ctx.s, pid(), true), () => ctx.act((s) => expandDeck(s, pid())), {
      cls: 'small',
      help: 'deck',
      labelFn: () => {
        const p = platformById(ctx.s, pid());
        const next = p ? DECK[p.deck + 1] : undefined;
        return next ? `${t('deck.expand')} → ${next.area}` : `${t('deck.expand')} · ${t('plant.max')}`;
      },
    });
    this.buttons.push(charter, release, deckBtn);

    this.el.append(
      h('div', { class: 'section-title' }, help(h('span', null, t('sea.title')), 'platformPlant'), this.deckVal),
      help(h('div', { class: 'deck-row' }, this.deckBar), 'deck', false),
      h('div', { class: 'btn-row' }, deckBtn.el),
      node('wells', 'plant.wells', withNote(() => term('wellsNode'), liftNote), 'wells', 'good'),
      arrow(),
      node('separator', 'plant.separator', withNote(() => modHelp('separator'), bnNote('separator')), 'sep', '',
        h('div', { class: 'btn-row' }, mod('separator', 'plant.upgrade'))),
      arrow(),
      h('div', { class: 'split' },
        node('storage', 'plant.tanks', withNote(() => modHelp('storage'), bnNote('storage', 'sea.tanksFullNote')), 'tank', '',
          h('div', { class: 'btn-row' }, mod('storage', 'plant.tanksBtn'))),
        node('export', 'sea.tankers', 'tankers', 'load', '', this.tankerList, h('div', { class: 'btn-row' }, charter.el, release.el)),
        node('water', 'plant.water', withNote(() => term('seaWater'), bnNote('water')), 'water', 'water',
          h('div', { style: 'margin-top:8px' },
            sub('plant.reinj', () => modHelp('injection'), 'inj', 'water', mod('injection', 'plant.pumps')),
            sub('sea.overboard', () => modHelp('waterTreat'), 'ob', 'water', mod('waterTreat', 'sea.treatBtn')))),
        node('gas', 'plant.gas', 'seaGas', 'gas', 'gas',
          h('div', { style: 'margin-top:8px' },
            sub('sea.fuel', () => modHelp('turbine'), 'fuel', 'gas', mod('turbine', 'sea.turbineBtn')),
            sub('sea.gasInj', () => modHelp('gasInj'), 'ginj', 'gas', mod('gasInj', 'plant.compressor')),
            sub('plant.flared', 'seaFlaring', 'gflare', 'gas'))),
        node('power', 'sea.power', 'power', 'pow', 'gas', this.power),
      ),
    );
  }

  update(p: Platform, pf: PlatformFlows): void {
    const bpd = ' ' + t('unit.bpd');
    const gas = ' ' + t('unit.gas');
    const set = (k: string, num: number, den: number, unit = '', fmt = fmtNum) => {
      const gg = this.g[k];
      gg.val.innerHTML = `<b>${fmt(num)}</b> / ${fmt(den)}${unit}`;
      setBar(gg.bar, den > 0 ? num / den : 0);
    };
    setText(this.deckVal, t('deck.used', { used: deckUsed(p), area: deckArea(p) }));
    setBar(this.deckBar, deckUsed(p) / deckArea(p));
    set('wells', pf.liquid, pf.liquidPotential, bpd);
    set('sep', pf.liquid, pf.sepCap, bpd);
    set('tank', p.storage, pf.storageCap, ' ' + t('unit.bbl'));
    set('load', pf.loaded, OFFSHORE.loadRate, bpd);
    set('water', pf.water, pf.waterCap, bpd);
    set('inj', pf.injected, pf.injCap, bpd);
    set('ob', pf.overboard, pf.waterTreatCap, bpd);
    set('gas', pf.gasFuel + pf.gasInjected, pf.gas, `${gas} ${t('sea.used')}`, fmtGasNum);
    set('fuel', pf.gasFuel, pf.turbineCap, gas, fmtGasNum);
    set('ginj', pf.gasInjected, pf.gasInjCap, gas, fmtGasNum);
    this.g.gflare.val.innerHTML = `<b>${fmtGasNum(pf.gasFlared)}</b>${gas}`;
    setBar(this.g.gflare.bar, pf.gas > 0 ? pf.gasFlared / pf.gas : 0);
    const covered = pf.powerDemand > 0 ? (pf.gasFuel * OFFSHORE.fuelValuePerMcf) / pf.powerDemand : 0;
    this.g.pow.val.innerHTML = `<b>${fmtPct(covered)}</b> ${t('sea.gasPowered')}`;
    setBar(this.g.pow.bar, covered);
    setText(this.power, t('sea.diesel', { cost: fmtMoney(pf.costs.diesel ?? 0) }));

    const key = p.tankers.map((tk) => tk.state).join(',');
    if (key !== this.tankerKey) {
      this.tankerKey = key;
      this.tankerRows = p.tankers.map(() => h('div', { class: 'tanker-row' }));
      this.tankerList.replaceChildren(...this.tankerRows);
    }
    p.tankers.forEach((tk, i) => {
      const row = this.tankerRows[i];
      setText(row, `${i + 1} · ${tankerText(tk)}`);
      toggleClass(row, 'moored', tk.state === 'moored');
      toggleClass(row, 'waiting', tk.state === 'port');
    });

    for (const k of ['separator', 'storage', 'water'] as const) toggleClass(this.nodes[k], 'bottleneck', pf.bottleneck === k);
    toggleClass(this.nodes.wells, 'limited', pf.liftLimitedWells > 0);
    for (const b of this.buttons) b.update();
  }
}

