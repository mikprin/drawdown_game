import { Application, Container, Graphics } from 'pixi.js';
import type { GameState, MapId } from '../game/types';
import { MapView } from './mapView';
import { SeaView } from './sea';
import { SiteView } from './site';
import { bakeAll } from './sprites';

export type ViewMode = 'site' | 'sea' | 'map';

interface Cam {
  x: number;
  y: number;
  zoom: number;
}

/** Owns the Pixi app, the three views and the scene cameras (drag to pan, wheel to zoom). */
export class Stage {
  mode: ViewMode = 'site';
  readonly site: SiteView;
  readonly sea: SeaView;
  readonly map: MapView;
  private cams: Record<'site' | 'sea', Cam>;
  private drag = { down: false, sx: 0, sy: 0, lx: 0, ly: 0, moved: false };
  private siteWorld = new Container();
  private seaWorld = new Container();
  /** Screen-space storm: dark wash and rain over the sea view. */
  private weather = new Graphics();
  private rainT = 0;

  private constructor(readonly app: Application) {
    const bank = bakeAll();
    this.site = new SiteView(bank);
    this.sea = new SeaView(bank);
    this.map = new MapView();
    this.siteWorld.addChild(this.site.root);
    this.seaWorld.addChild(this.sea.root);
    app.stage.addChild(this.siteWorld, this.seaWorld, this.weather, this.map.root);
    const isDrag = () => this.drag.moved;
    this.site.isDragGesture = isDrag;
    this.sea.isDragGesture = isDrag;
    this.map.isDragGesture = isDrag;
    const zoom = Math.max(0.5, Math.min(1.2, app.screen.width / 1150));
    const [fx, fy] = this.site.focusPoint();
    const [sx, sy] = this.sea.focusPoint();
    this.cams = { site: { x: fx, y: fy, zoom }, sea: { x: sx, y: sy, zoom: zoom * 0.95 } };
    this.bindInput();
    this.setMode('site');
    app.renderer.on('resize', () => this.layout());
  }

  static async create(host: HTMLElement): Promise<Stage> {
    const app = new Application();
    await app.init({
      resizeTo: host,
      background: 0x16120e,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(2, window.devicePixelRatio || 1),
    });
    host.appendChild(app.canvas);
    return new Stage(app);
  }

  setMode(mode: ViewMode): void {
    this.mode = mode;
    this.siteWorld.visible = mode === 'site';
    this.seaWorld.visible = mode === 'sea';
    this.weather.visible = mode === 'sea';
    this.map.root.visible = mode === 'map';
    this.layout();
  }

  sync(s: GameState, platform: number | null, map: MapId): void {
    this.site.sync(s);
    if (this.mode === 'sea') this.sea.sync(s, platform);
    if (this.mode === 'map') this.map.sync(s, map);
    this.layout();
  }

  frame(s: GameState, dt: number, speed: number): void {
    if (this.mode === 'site') this.site.update(s, dt, speed);
    else if (this.mode === 'sea') {
      this.sea.update(s, dt, speed);
      this.drawWeather(s, dt * (speed > 0 ? 1 : 0));
    } else this.map.update(s, dt);
  }

  private drawWeather(s: GameState, dt: number): void {
    const g = this.weather;
    g.clear();
    if (s.weather.storm <= 0) return;
    const { width: W, height: H } = this.app.screen;
    this.rainT += dt;
    g.rect(0, 0, W, H).fill({ color: 0x0a1418, alpha: 0.38 });
    // Rain: slanted streaks on a deterministic grid that scrolls.
    const RW = W + 200, RH = H + 60;
    for (let i = 0; i < 160; i++) {
      const bx = ((i * 0.618034) % 1) * RW, by = ((i * 0.414214) % 1) * RH;
      const x = (((bx - this.rainT * 220) % RW) + RW) % RW - 100;
      const y = ((by + this.rainT * 900) % RH) - 30;
      g.moveTo(x, y).lineTo(x - 7, y + 22);
    }
    g.stroke({ width: 1, color: 0xb8ccd4, alpha: 0.35 });
  }

  private cam(): Cam | null {
    return this.mode === 'map' ? null : this.cams[this.mode];
  }

  private world(): Container {
    return this.mode === 'sea' ? this.seaWorld : this.siteWorld;
  }

  private layout(): void {
    const { width: W, height: H } = this.app.screen;
    for (const m of ['site', 'sea'] as const) {
      const c = this.cams[m];
      const w = m === 'sea' ? this.seaWorld : this.siteWorld;
      w.scale.set(c.zoom);
      w.position.set(Math.round(W / 2 - c.x * c.zoom), Math.round(H / 2 - c.y * c.zoom));
    }
    const [mw, mh] = this.map.size();
    if (mw > 0) {
      const k = Math.min((W - 24) / mw, (H - 24) / mh);
      this.map.root.scale.set(k);
      this.map.root.position.set(Math.round((W - mw * k) / 2), Math.round((H - mh * k) / 2));
    }
  }

  private bindInput(): void {
    const canvas = this.app.canvas;
    canvas.addEventListener('pointerdown', (e) => {
      this.drag = { down: true, sx: e.clientX, sy: e.clientY, lx: e.clientX, ly: e.clientY, moved: false };
    });
    window.addEventListener('pointermove', (e) => {
      const d = this.drag;
      if (!d.down) return;
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 5) d.moved = true;
      const c = this.cam();
      if (d.moved && c) {
        c.x -= (e.clientX - d.lx) / c.zoom;
        c.y -= (e.clientY - d.ly) / c.zoom;
        this.layout();
      }
      d.lx = e.clientX;
      d.ly = e.clientY;
    });
    window.addEventListener('pointerup', () => {
      this.drag.down = false;
      // `moved` survives until the tap event fires, then the next pointerdown resets it.
    });
    canvas.addEventListener('wheel', (e) => {
      const c = this.cam();
      if (!c) return;
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const before = this.screenToWorld(mx, my);
      c.zoom = Math.max(0.35, Math.min(2.2, c.zoom * Math.exp(-e.deltaY * 0.0015)));
      this.layout();
      const after = this.screenToWorld(mx, my);
      c.x += before[0] - after[0];
      c.y += before[1] - after[1];
      this.layout();
    }, { passive: false });
  }

  private screenToWorld(x: number, y: number): [number, number] {
    const w = this.world();
    return [(x - w.x) / w.scale.x, (y - w.y) / w.scale.y];
  }

  /** Center the current scene camera on a world-screen point. */
  focus(x: number, y: number): void {
    const c = this.cam();
    if (!c) return;
    c.x = x;
    c.y = y;
    this.layout();
  }
}
