import { Application, Container } from 'pixi.js';
import type { GameState } from '../game/types';
import { MapView } from './mapView';
import { SiteView } from './site';
import { bakeAll } from './sprites';

export type ViewMode = 'site' | 'map';

/** Owns the Pixi app, the two views and the site camera (drag to pan, wheel to zoom). */
export class Stage {
  mode: ViewMode = 'site';
  readonly site: SiteView;
  readonly map: MapView;
  private cam = { x: 0, y: 0, zoom: 1 };
  private drag = { down: false, sx: 0, sy: 0, lx: 0, ly: 0, moved: false };
  private world = new Container();

  private constructor(readonly app: Application) {
    this.site = new SiteView(bakeAll());
    this.map = new MapView();
    this.world.addChild(this.site.root);
    app.stage.addChild(this.world, this.map.root);
    const isDrag = () => this.drag.moved;
    this.site.isDragGesture = isDrag;
    this.map.isDragGesture = isDrag;
    const [fx, fy] = this.site.focusPoint();
    this.cam = { x: fx, y: fy, zoom: Math.max(0.5, Math.min(1.2, app.screen.width / 1150)) };
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
    this.world.visible = mode === 'site';
    this.map.root.visible = mode === 'map';
    this.layout();
  }

  sync(s: GameState): void {
    this.site.sync(s);
    this.map.sync(s);
    this.layout();
  }

  frame(s: GameState, dt: number, speed: number): void {
    if (this.mode === 'site') this.site.update(s, dt, speed);
    else this.map.update(s, dt);
  }

  private layout(): void {
    const { width: W, height: H } = this.app.screen;
    const c = this.cam;
    this.world.scale.set(c.zoom);
    this.world.position.set(Math.round(W / 2 - c.x * c.zoom), Math.round(H / 2 - c.y * c.zoom));
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
      if (d.moved && this.mode === 'site') {
        this.cam.x -= (e.clientX - d.lx) / this.cam.zoom;
        this.cam.y -= (e.clientY - d.ly) / this.cam.zoom;
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
      if (this.mode !== 'site') return;
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const before = this.screenToWorld(mx, my);
      this.cam.zoom = Math.max(0.35, Math.min(2.2, this.cam.zoom * Math.exp(-e.deltaY * 0.0015)));
      this.layout();
      const after = this.screenToWorld(mx, my);
      this.cam.x += before[0] - after[0];
      this.cam.y += before[1] - after[1];
      this.layout();
    }, { passive: false });
  }

  private screenToWorld(x: number, y: number): [number, number] {
    return [(x - this.world.x) / this.cam.zoom, (y - this.world.y) / this.cam.zoom];
  }

  /** Center the site camera on a world-screen point. */
  focus(x: number, y: number): void {
    this.cam.x = x;
    this.cam.y = y;
    this.layout();
  }
}
