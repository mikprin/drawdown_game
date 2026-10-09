import './ui/style.css';
import * as actions from './game/actions';
import { TIME } from './game/balance';
import { fmtBbl, fmtMoney } from './game/format';
import { msg } from './game/msg';
import { newGame } from './game/newGame';
import { platformOfField } from './game/platform';
import { reserveEstimate, wellById } from './game/reservoir';
import { clearSave, loadGame, saveGame, simulateOffline, type OfflineReport } from './game/save';
import { step } from './game/sim';
import type { GameState } from './game/types';
import { getLang, setLang, t } from './i18n';
import { PADS } from './render/layout';
import { iso } from './render/paint';
import { DECK_FOCUS } from './render/sea';
import { Stage, type ViewMode } from './render/stage';
import { BottomBar } from './ui/bottom';
import type { Ctx, UiState } from './ui/ctx';
import { h, toggleClass } from './ui/dom';
import { cellTooltip, ExplorePanel } from './ui/explore';
import { HelpCard } from './ui/help';
import { banner, modal } from './ui/modal';
import { OpsPanel } from './ui/ops';
import { PlantPanel } from './ui/plant';
import { TopBar } from './ui/topbar';

const $ = (id: string) => document.getElementById(id)!;

async function main(): Promise<void> {
  document.documentElement.lang = getLang();
  $('loading').textContent = t('loading');
  let s: GameState;
  let offline: OfflineReport | null = null;
  const loaded = loadGame();
  if (loaded) {
    s = loaded;
    offline = simulateOffline(s, (Date.now() - s.savedAt) / 1000);
  } else {
    s = newGame();
  }

  const view = $('view');
  const stage = await Stage.create(view);
  $('loading').remove();

  const ui: UiState = { view: 'site', field: 1, platform: s.platforms[0]?.id ?? null, well: null, cell: null, map: 'land', speed: 1 };
  let resetting = false;
  const persist = () => {
    if (!resetting) saveGame(s);
  };

  const ctx: Ctx = {
    get s() {
      return s;
    },
    ui,
    act(fn) {
      fn(s);
      refresh();
    },
    setView(v: ViewMode) {
      if (v === 'sea' && !s.platforms.length) return;
      ui.view = v;
      if (v === 'sea' && !s.platforms.some((p) => p.id === ui.platform)) ui.platform = s.platforms[0].id;
      stage.setMode(v);
      refresh();
    },
    selectWell(id) {
      ui.well = id;
      const w = id !== null ? wellById(s, id) : undefined;
      if (w) {
        const p = platformOfField(s, w.fieldId);
        if (p) ui.platform = p.id;
        else ui.field = w.fieldId;
      }
      stage.site.selectedWell = id;
      stage.sea.selectedWell = id;
      refresh();
    },
    selectPlatform(id) {
      ui.platform = id;
      ui.well = null;
      stage.sea.selectedWell = null;
      if (ui.view !== 'sea') {
        ui.view = 'sea';
        stage.setMode('sea');
      }
      stage.focus(DECK_FOCUS[0], DECK_FOCUS[1]);
      refresh();
    },
    setMap(m) {
      if (m === ui.map) return;
      ui.map = m;
      ui.cell = null;
      stage.map.selected = null;
      refresh();
    },
    selectField(id) {
      ui.field = id;
      ui.well = null;
      stage.site.selectedWell = null;
      const f = s.fields.find((x) => x.id === id);
      if (f && f.padIndex >= 0) {
        const p = PADS[f.padIndex];
        const [x, y] = iso(p.x + p.w / 2, p.y + p.h / 2);
        stage.focus(x, y);
      }
      refresh();
    },
    selectCell(x, y) {
      ui.cell = { x, y };
      stage.map.selected = { x, y };
      if (ui.view !== 'map') ctx.setView('map');
      refresh();
    },
    setSpeed(v) {
      ui.speed = v;
      refresh();
    },
    newGame() {
      resetting = true;
      clearSave();
      location.reload();
    },
    save() {
      persist();
      s.log.unshift({ day: s.day, msg: msg('log.saved'), kind: 'info' });
      refresh();
    },
    setLang(lang) {
      if (lang === getLang()) return;
      setLang(lang);
      document.documentElement.lang = lang;
      mountUi();
      refresh();
    },
  };

  const helpCard = new HelpCard($('help'));
  let top: TopBar, ops: OpsPanel, explore: ExplorePanel, plant: PlantPanel, bottom: BottomBar;
  let siteTab: HTMLButtonElement, seaTab: HTMLButtonElement, mapTab: HTMLButtonElement, hint: HTMLDivElement;

  /** Build every DOM panel from scratch. Panels read strings once, so a language switch rebuilds them. */
  function mountUi(): void {
    helpCard.hide();
    for (const id of ['topbar', 'left', 'right', 'bottom']) $(id).replaceChildren();
    view.querySelectorAll('.view-tabs, .view-hint').forEach((el) => el.remove());
    top = new TopBar($('topbar'), ctx);
    ops = new OpsPanel(ctx);
    explore = new ExplorePanel(ctx);
    $('left').append(ops.el, explore.el);
    plant = new PlantPanel(ctx);
    $('right').append(plant.el);
    bottom = new BottomBar($('bottom'), ctx);
    siteTab = h('button', { class: 'btn', onclick: () => ctx.setView('site') }, t('view.site'));
    seaTab = h('button', { class: 'btn', onclick: () => ctx.setView('sea') }, t('view.sea'));
    mapTab = h('button', { class: 'btn', onclick: () => ctx.setView('map') }, t('view.map'));
    hint = h('div', { class: 'view-hint' });
    view.append(h('div', { class: 'view-tabs' }, siteTab, seaTab, mapTab), hint);
  }
  mountUi();

  const tooltip = $('tooltip');
  stage.site.onSelectWell = (id) => ctx.selectWell(id);
  stage.sea.onSelectWell = (id) => ctx.selectWell(id);
  stage.map.onSelectCell = (x, y) => ctx.selectCell(x, y);
  stage.map.onHover = (cell, gx, gy) => {
    if (!cell) {
      tooltip.hidden = true;
      return;
    }
    tooltip.innerHTML = cellTooltip(s, stage.map.map, cell.x, cell.y);
    tooltip.hidden = false;
    const r = stage.app.canvas.getBoundingClientRect();
    tooltip.style.left = `${Math.min(window.innerWidth - 270, r.left + gx + 16)}px`;
    tooltip.style.top = `${r.top + gy + 16}px`;
  };

  let seen = { wildcats: s.stats.wildcats, discoveries: s.stats.discoveries, storm: s.weather.storm > 0 };

  function refresh(): void {
    if (ui.view === 'sea' && !s.platforms.length) {
      // The last platform was decommissioned: back to land.
      ui.view = 'site';
      stage.setMode('site');
    }
    stage.sync(s, ui.platform, ui.map);
    top.update();
    ops.el.style.display = ui.view !== 'map' ? '' : 'none';
    explore.el.style.display = ui.view === 'map' ? '' : 'none';
    if (ui.view !== 'map') ops.update();
    else explore.update();
    plant.update();
    bottom.update();
    toggleClass(siteTab, 'on', ui.view === 'site');
    toggleClass(seaTab, 'on', ui.view === 'sea');
    toggleClass(mapTab, 'on', ui.view === 'map');
    // Tabs carry the alarms of scenes you are not looking at: red = a plant is choking wells, blue = storm at sea.
    seaTab.style.display = s.platforms.length ? '' : 'none';
    toggleClass(siteTab, 'alert', s.flows.bottleneck !== 'none');
    toggleClass(seaTab, 'alert', Object.values(s.flows.platforms).some((pf) => pf.bottleneck !== 'none'));
    toggleClass(seaTab, 'storm', s.weather.storm > 0);
    hint.textContent = t(ui.view === 'site' ? 'view.hintSite' : ui.view === 'sea' ? 'view.hintSea' : 'view.hintMap');
    helpCard.update();
    const storm = s.weather.storm > 0;
    if (storm && !seen.storm && s.platforms.length) banner(view, t('banner.storm'), t('banner.stormSub'), 'dry');
    seen.storm = storm;
    if (s.stats.wildcats > seen.wildcats) {
      if (s.stats.discoveries > seen.discoveries) {
        const f = s.fields[s.fields.length - 1];
        const est = reserveEstimate(f);
        const gusher = est.p50 > (f.offshore ? 15_000_000 : 1_500_000);
        banner(view, t(gusher ? 'banner.gusher' : 'banner.discovery'), t('banner.discoverySub', { field: f.name, p50: est.p50 }));
      } else {
        banner(view, t('banner.dry'), t('banner.drySub'), 'dry');
      }
      seen = { ...seen, wildcats: s.stats.wildcats, discoveries: s.stats.discoveries };
    }
  }

  // ---------- loop ----------
  let acc = 0, uiTimer = 0, saveTimer = 0;
  stage.app.ticker.add((t) => {
    const dt = Math.min(0.25, t.deltaMS / 1000);
    acc += dt * TIME.daysPerSecond * ui.speed;
    let n = 0;
    while (acc >= TIME.tickDays && n < 300) {
      step(s, TIME.tickDays);
      acc -= TIME.tickDays;
      n++;
    }
    if (n >= 300) acc = 0;
    stage.frame(s, dt, ui.speed);
    uiTimer += dt;
    if (uiTimer >= 0.2) {
      uiTimer = 0;
      refresh();
    }
    saveTimer += dt;
    if (saveTimer >= TIME.autosaveSeconds) {
      saveTimer = 0;
      persist();
    }
  });

  // Browsers stop animation frames in background tabs; catch up on return.
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      hiddenAt = Date.now();
      persist();
    } else if (hiddenAt && ui.speed > 0) {
      const r = simulateOffline(s, ((Date.now() - hiddenAt) / 1000) * ui.speed);
      if (r) s.log.unshift({ day: s.day, msg: msg('log.caughtUp', { days: Math.round(r.days), cash: r.cash }), kind: 'info' });
      hiddenAt = 0;
      refresh();
    }
  });
  window.addEventListener('beforeunload', persist);

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.code === 'Space') {
      e.preventDefault();
      ctx.setSpeed(ui.speed === 0 ? 1 : 0);
    } else if (e.key === 'm' || e.key === 'M') ctx.setView(ui.view === 'site' ? 'map' : 'site');
    else if (e.key === '1') ctx.setSpeed(1);
    else if (e.key === '2') ctx.setSpeed(2);
    else if (e.key === '3') ctx.setSpeed(5);
    else if (e.key === 'Escape') ctx.selectWell(null);
  });

  if (import.meta.env.DEV) {
    // Debug handle for automated checks: window.__drawdown.s, .ctx, .step(days)
    Object.assign(window, {
      __drawdown: {
        get s() { return s; },
        ctx,
        actions,
        step(days: number) { for (let d = 0; d < days; d += 0.5) step(s, 0.5); refresh(); },
      },
    });
  }

  refresh();

  if (offline && offline.days >= 5) {
    modal(t('away.title'), h('div', null,
      h('p', null, t('away.days', { days: Math.round(offline.days) })),
      offline.days >= 365 ? h('p', { class: 'muted' }, t('away.cap')) : null,
      h('div', { class: 'kv' },
        h('span', { class: 'k' }, t('away.oil')), h('span', { class: 'v oil' }, fmtBbl(offline.oil)),
        h('span', { class: 'k' }, t('away.sold')), h('span', { class: 'v' }, fmtBbl(offline.sold)),
        h('span', { class: 'k' }, t('away.cash')), h('span', { class: `v ${offline.cash >= 0 ? 'good' : 'bad'}` }, fmtMoney(offline.cash)))),
      [{ label: t('away.ok'), cls: 'primary' }]);
  } else if (!loaded) {
    modal(t('intro.title'), h('div', null,
      h('p', null, t('intro.p1')),
      h('p', null, t('intro.p2')),
      h('p', { class: 'muted' }, t('intro.p3')),
      h('p', { class: 'muted' }, t('intro.p4'))),
      [{ label: t('intro.ok'), cls: 'primary' }]);
  }
}

main().catch((err) => {
  console.error(err);
  const el = document.getElementById('loading');
  if (el) el.textContent = t('loading.failed', { error: err instanceof Error ? err.message : String(err) });
});
