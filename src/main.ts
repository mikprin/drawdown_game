import './ui/style.css';
import * as actions from './game/actions';
import { TIME } from './game/balance';
import { fmtBbl, fmtMoney } from './game/format';
import { newGame } from './game/newGame';
import { reserveEstimate, wellById } from './game/reservoir';
import { clearSave, loadGame, saveGame, simulateOffline, type OfflineReport } from './game/save';
import { step } from './game/sim';
import type { GameState } from './game/types';
import { PADS } from './render/layout';
import { iso } from './render/paint';
import { Stage, type ViewMode } from './render/stage';
import { BottomBar } from './ui/bottom';
import type { Ctx, UiState } from './ui/ctx';
import { h, toggleClass } from './ui/dom';
import { cellTooltip, ExplorePanel } from './ui/explore';
import { banner, modal } from './ui/modal';
import { OpsPanel } from './ui/ops';
import { PlantPanel } from './ui/plant';
import { TopBar } from './ui/topbar';

const $ = (id: string) => document.getElementById(id)!;

async function main(): Promise<void> {
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

  const ui: UiState = { view: 'site', field: 1, well: null, cell: null, speed: 1 };
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
      ui.view = v;
      stage.setMode(v);
      refresh();
    },
    selectWell(id) {
      ui.well = id;
      const w = id !== null ? wellById(s, id) : undefined;
      if (w) ui.field = w.fieldId;
      stage.site.selectedWell = id;
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
      s.log.unshift({ day: s.day, text: 'Game saved.', kind: 'info' });
      refresh();
    },
  };

  const top = new TopBar($('topbar'), ctx);
  const ops = new OpsPanel(ctx);
  const explore = new ExplorePanel(ctx);
  $('left').append(ops.el, explore.el);
  const plant = new PlantPanel(ctx);
  $('right').append(plant.el);
  const bottom = new BottomBar($('bottom'), ctx);

  const siteTab = h('button', { class: 'btn', onclick: () => ctx.setView('site') }, 'Site');
  const mapTab = h('button', { class: 'btn', onclick: () => ctx.setView('map') }, 'Regional map');
  const hint = h('div', { class: 'view-hint' });
  view.append(h('div', { class: 'view-tabs' }, siteTab, mapTab), hint);

  const tooltip = $('tooltip');
  stage.site.onSelectWell = (id) => ctx.selectWell(id);
  stage.map.onSelectCell = (x, y) => ctx.selectCell(x, y);
  stage.map.onHover = (cell, gx, gy) => {
    if (!cell) {
      tooltip.hidden = true;
      return;
    }
    tooltip.innerHTML = cellTooltip(s, cell.x, cell.y);
    tooltip.hidden = false;
    const r = stage.app.canvas.getBoundingClientRect();
    tooltip.style.left = `${Math.min(window.innerWidth - 270, r.left + gx + 16)}px`;
    tooltip.style.top = `${r.top + gy + 16}px`;
  };

  let seen = { wildcats: s.stats.wildcats, discoveries: s.stats.discoveries };

  function refresh(): void {
    stage.sync(s);
    top.update();
    ops.el.style.display = ui.view === 'site' ? '' : 'none';
    explore.el.style.display = ui.view === 'map' ? '' : 'none';
    if (ui.view === 'site') ops.update();
    else explore.update();
    plant.update();
    bottom.update();
    toggleClass(siteTab, 'on', ui.view === 'site');
    toggleClass(mapTab, 'on', ui.view === 'map');
    hint.textContent = ui.view === 'site'
      ? 'Drag to pan · wheel to zoom · click a well · Space pauses · M toggles map'
      : 'Click a cell · seismic lifts the fog block by block · drill the best leads';
    if (s.stats.wildcats > seen.wildcats) {
      if (s.stats.discoveries > seen.discoveries) {
        const f = s.fields[s.fields.length - 1];
        const est = reserveEstimate(f);
        banner(view, est.p50 > 1_500_000 ? 'GUSHER!' : 'DISCOVERY', `${f.name} · P50 ${fmtBbl(est.p50)} recoverable`);
      } else {
        banner(view, 'DRY HOLE', 'Nothing but brine and regret.', 'dry');
      }
      seen = { wildcats: s.stats.wildcats, discoveries: s.stats.discoveries };
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
      if (r) s.log.unshift({ day: s.day, text: `Caught up ${Math.round(r.days)} days while away: ${fmtMoney(r.cash)}.`, kind: 'info' });
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
    modal('While you were away', h('div', null,
      h('p', null, `${Math.round(offline.days)} days passed on the field${offline.days >= 365 ? ' (offline progress is capped at one year)' : ''}.`),
      h('div', { class: 'kv' },
        h('span', { class: 'k' }, 'Oil produced'), h('span', { class: 'v oil' }, fmtBbl(offline.oil)),
        h('span', { class: 'k' }, 'Oil sold'), h('span', { class: 'v' }, fmtBbl(offline.sold)),
        h('span', { class: 'k' }, 'Cash change'), h('span', { class: `v ${offline.cash >= 0 ? 'good' : 'bad'}` }, fmtMoney(offline.cash)))),
      [{ label: 'Back to work', cls: 'primary' }]);
  } else if (!loaded) {
    modal('Drawdown', h('div', null,
      h('p', null, 'You inherit one tired pumpjack on the Old Barrow field. Production falls on its own — that is the decline curve, and fighting it is the job.'),
      h('p', null, 'Watch the plant on the right: separator, tanks, export and water handling each cap your output. The red BOTTLENECK moves as you grow.'),
      h('p', { class: 'muted' }, 'Wells water out over time. Waterflood, better lift and fracs push back. When the home field fades, the regional map holds the next one — if you can find it.')),
      [{ label: 'Start pumping', cls: 'primary' }]);
  }
}

main().catch((err) => {
  console.error(err);
  const el = document.getElementById('loading');
  if (el) el.textContent = `Failed to start: ${err instanceof Error ? err.message : String(err)}`;
});
