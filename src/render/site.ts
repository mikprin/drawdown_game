import { Container, Graphics, Sprite, Text } from 'pixi.js';
import { fieldById } from '../game/reservoir';
import type { GameState, Well } from '../game/types';
import { bakeGround, groundKey, type GroundSpec } from './ground';
import { MANIFOLD, PADS, PIPELINE, ROAD, SPOTS, WORLD, padOutlet, slotPos } from './layout';
import { iso, spriteOf, ZT, type Baked } from './paint';
import { FLARE_TIP_Z, PALETTE, type SpriteBank, type WellheadKind } from './sprites';
import { fmtRate } from '../game/format';
import { t as tr } from '../i18n';

type WellKind = 'pumpjack' | WellheadKind | 'drill';

interface WellVis {
  id: number;
  root: Container;
  kind: WellKind;
  beam: Graphics | null;
  rig: Sprite | null;
  phase: number;
  gx: number;
  gy: number;
}

interface Truck {
  sprite: Container;
  out: Sprite;
  back: Sprite;
  t: number;
}

interface Puff {
  s: Sprite;
  life: number;
  vx: number;
  vy: number;
}

const depth = (gx: number, gy: number) => (gx + gy) * 10;

export class SiteView {
  readonly root = new Container();
  selectedWell: number | null = null;
  onSelectWell: (id: number) => void = () => {};
  isDragGesture: () => boolean = () => false;

  private ground: Sprite | null = null;
  private groundKeyStr = '';
  private lines = new Graphics();
  private flow = new Graphics();
  private objects = new Container();
  private gauges = new Graphics();
  private fx = new Container();
  private overlay = new Graphics();
  private labels = new Container();
  private wells = new Map<number, WellVis>();
  private plantKey = '';
  private plantSprites: Container[] = [];
  private tankSpots: { x: number; y: number; r: number; h: number }[] = [];
  private beaconSpots: Record<string, [number, number, number]> = {};
  private trucks: Truck[] = [];
  private flames: Sprite[] = [];
  private puffs: Puff[] = [];
  private beacons = new Map<string, Sprite>();
  private padLabels = new Map<number, Text>();
  private time = 0;
  private puffTimer = 0;

  constructor(private bank: SpriteBank) {
    this.objects.sortableChildren = true;
    this.fx.blendMode = 'add';
    this.root.addChild(this.lines, this.flow, this.objects, this.gauges, this.fx, this.overlay, this.labels);
    this.addScenery();
    this.addFlare();
  }

  /** Screen position of the world centre, for the camera. */
  focusPoint(): [number, number] {
    return iso(34, 21.5);
  }

  private place(baked: Baked, gx: number, gy: number, scale = 1): Sprite {
    const s = spriteOf(baked);
    const [x, y] = iso(gx, gy);
    s.position.set(x, y);
    s.scale.set(scale);
    s.zIndex = depth(gx, gy);
    this.objects.addChild(s);
    return s;
  }

  private addScenery(): void {
    // Deterministic scrub scattered away from built areas.
    let n = 0;
    for (let i = 0; i < 400 && n < 140; i++) {
      const gx = ((i * 7919) % 997) / 997 * WORLD;
      const gy = ((i * 6271) % 991) / 991 * WORLD;
      const d = Math.hypot(gx - WORLD / 2, gy - WORLD / 2);
      if (d > WORLD * 0.42) continue;
      const blocked =
        (gx > 20 && gx < 39 && gy > 19 && gy < 36) ||
        PADS.some((p) => gx > p.x - 1 && gx < p.x + p.w + 1 && gy > p.y - 1 && gy < p.y + p.h + 1) ||
        Math.abs(gy - ROAD.y) < 1.6 || Math.abs(gx - PIPELINE.x) < 1.2;
      if (blocked) continue;
      const s = this.place(this.bank.bushes[i % this.bank.bushes.length], gx, gy, 0.6 + ((i * 13) % 7) / 10);
      s.zIndex -= 2;
      n++;
    }
  }

  private addFlare(): void {
    const [fx, fy] = SPOTS.flare;
    this.place(this.bank.flare, fx, fy);
    const [x, y] = iso(fx, fy, FLARE_TIP_Z);
    for (const [tint, sc] of [[0xff5a10, 1.6], [0xff9a30, 1.0], [0xffe08a, 0.55]] as const) {
      const g = new Sprite(this.bank.glow);
      g.anchor.set(0.5, 0.75);
      g.tint = tint;
      g.position.set(x, y);
      g.scale.set(sc);
      this.fx.addChild(g);
      this.flames.push(g);
    }
  }

  // ---------- sync with game state ----------

  sync(s: GameState): void {
    const developedPads = s.fields.filter((f) => f.developed || f.devJob).map((f) => f.padIndex).sort();
    const spec: GroundSpec = { pads: developedPads, pond: s.facilities.swd > 0, pipeline: s.facilities.pipeline > 0 };
    const gk = groundKey(spec);
    if (gk !== this.groundKeyStr) {
      this.groundKeyStr = gk;
      if (this.ground) {
        this.ground.texture.destroy(true);
        this.ground.destroy();
      }
      this.ground = spriteOf(bakeGround(spec));
      this.root.addChildAt(this.ground, 0);
    }
    this.syncPlant(s);
    this.syncWells(s);
    this.syncLabels(s);
  }

  private syncPlant(s: GameState): void {
    const f = s.facilities;
    const devJobs = s.fields.filter((x) => x.devJob).map((x) => x.padIndex).join(',');
    const key = [f.separator, f.storage, f.waterTrucks, f.swd, f.injection, f.compressor, Math.min(8, f.trucks), devJobs].join('|');
    if (key === this.plantKey) return;
    this.plantKey = key;
    for (const c of this.plantSprites) c.destroy();
    this.plantSprites = [];
    const add = (baked: Baked, gx: number, gy: number, scale = 1) => {
      this.plantSprites.push(this.place(baked, gx, gy, scale));
    };

    const sepCount = [1, 1, 2, 3, 4][f.separator];
    for (let i = 0; i < sepCount; i++) add(this.bank.separator, SPOTS.separators[i][0], SPOTS.separators[i][1], f.separator === 0 ? 0.85 : 1);
    this.beaconSpots.separator = [SPOTS.separators[0][0] + 1.5, SPOTS.separators[0][1], 60];

    const tankDefs: [Baked, number, number][] = [
      [this.bank.tankS, 0.85, 46], [this.bank.tankS, 0.85, 46], [this.bank.tankM, 1.15, 62], [this.bank.tankM, 1.15, 62], [this.bank.tankM, 1.15, 62],
    ];
    const tankCount = [1, 2, 3, 4, 6][f.storage];
    const [tb, tr, th] = tankDefs[f.storage];
    this.tankSpots = [];
    for (let i = 0; i < tankCount; i++) {
      const [x, y] = SPOTS.tanks[i];
      add(tb, x, y);
      this.tankSpots.push({ x, y, r: tr, h: th });
    }
    this.beaconSpots.storage = [SPOTS.tanks[0][0], SPOTS.tanks[0][1], th + 20];

    const wt = Math.min(3, 1 + Math.floor(f.waterTrucks / 3));
    for (let i = 0; i < wt; i++) add(this.bank.waterTank, SPOTS.waterTanks[i][0], SPOTS.waterTanks[i][1]);
    this.beaconSpots.water = [SPOTS.waterTanks[0][0], SPOTS.waterTanks[0][1], 70];

    for (let i = 0; i < f.injection; i++) add(this.bank.injection, SPOTS.injection[i][0], SPOTS.injection[i][1]);
    if (f.compressor > 0) add(this.bank.compressor, SPOTS.compressor[0], SPOTS.compressor[1]);
    if (f.swd > 0) add(this.bank.swd, SPOTS.swd[0], SPOTS.swd[1]);
    add(this.bank.cabin, SPOTS.cabin[0], SPOTS.cabin[1]);

    // Pads under construction get a rig on slot 0.
    for (const fl of s.fields) {
      if (!fl.devJob) continue;
      const [gx, gy] = slotPos(fl.padIndex, 0);
      add(this.bank.derrick, gx, gy, 0.9);
    }

    // Trucks.
    const want = Math.min(8, f.trucks);
    for (const t of this.trucks) t.sprite.destroy({ children: true });
    this.trucks = [];
    for (let i = 0; i < want; i++) {
      const out = spriteOf(this.bank.truckOut);
      const back = spriteOf(this.bank.truckIn);
      const holder = new Container();
      holder.addChild(out, back);
      this.objects.addChild(holder);
      this.trucks.push({ sprite: holder, out, back, t: i / want });
    }
  }

  private wellKind(w: Well): WellKind {
    if (w.job?.kind === 'drill') return 'drill';
    if (w.status === 'injector' || w.job?.kind === 'convert') return 'injector';
    if (w.lift === 'rodpump') return 'pumpjack';
    return w.lift as WellheadKind;
  }

  private syncWells(s: GameState): void {
    const seen = new Set<number>();
    for (const w of s.wells) {
      const f = fieldById(s, w.fieldId);
      if (f.padIndex < 0) continue;
      seen.add(w.id);
      const kind = this.wellKind(w);
      let v = this.wells.get(w.id);
      if (v && v.kind !== kind) {
        v.root.destroy({ children: true });
        this.wells.delete(w.id);
        v = undefined;
      }
      if (!v) {
        const [gx, gy] = slotPos(f.padIndex, w.slot);
        v = this.makeWell(w.id, kind, gx, gy);
        this.wells.set(w.id, v);
      }
      const busy = !!w.job && w.job.kind !== 'drill';
      if (busy && !v.rig) {
        v.rig = spriteOf(this.bank.derrick);
        v.rig.scale.set(0.45);
        v.rig.position.set(-6, -2);
        v.root.addChild(v.rig);
      } else if (!busy && v.rig && kind !== 'drill') {
        v.rig.destroy();
        v.rig = null;
      }
    }
    for (const [id, v] of this.wells) {
      if (!seen.has(id)) {
        v.root.destroy({ children: true });
        this.wells.delete(id);
      }
    }
  }

  private makeWell(id: number, kind: WellKind, gx: number, gy: number): WellVis {
    const root = new Container();
    const [x, y] = iso(gx, gy);
    root.position.set(x, y);
    root.zIndex = depth(gx, gy) + 5;
    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.on('pointertap', () => {
      if (!this.isDragGesture()) this.onSelectWell(id);
    });
    root.on('pointerover', () => { root.alpha = 0.85; });
    root.on('pointerout', () => { root.alpha = 1; });
    let beam: Graphics | null = null;
    let rig: Sprite | null = null;
    if (kind === 'drill') {
      rig = spriteOf(this.bank.derrick);
      rig.scale.set(0.8);
      root.addChild(rig);
    } else if (kind === 'pumpjack') {
      root.addChild(spriteOf(this.bank.pumpjack));
      beam = new Graphics();
      root.addChild(beam);
    } else {
      root.addChild(spriteOf(this.bank.wellhead[kind]));
    }
    this.objects.addChild(root);
    return { id, root, kind, beam, rig, phase: (id * 1.7) % (Math.PI * 2), gx, gy };
  }

  private syncLabels(s: GameState): void {
    const seen = new Set<number>();
    for (const f of s.fields) {
      if (!(f.developed || f.devJob) || f.padIndex < 0) continue;
      seen.add(f.id);
      let t = this.padLabels.get(f.id);
      if (!t) {
        t = new Text({
          text: '',
          style: { fontFamily: 'IBM Plex Mono, monospace', fontSize: 13, fill: 0xeadfc8, stroke: { color: 0x120e0a, width: 4 }, fontWeight: '600' },
        });
        t.resolution = 2;
        t.anchor.set(0.5, 1);
        const p = PADS[f.padIndex];
        const [x, y] = iso(p.x, p.y + p.h, 0);
        t.position.set(x + 10, y - 6);
        this.labels.addChild(t);
        this.padLabels.set(f.id, t);
      }
      let oil = 0;
      for (const w of s.wells) if (w.fieldId === f.id) oil += s.flows.wells[w.id]?.oil ?? 0;
      t.text = `${f.name.toUpperCase()} · ${f.devJob ? tr('site.building') : fmtRate(oil)}`;
    }
    for (const [id, t] of this.padLabels) if (!seen.has(id)) { t.destroy(); this.padLabels.delete(id); }
  }

  // ---------- per-frame animation ----------

  update(s: GameState, dt: number, speed: number): void {
    this.time += dt;
    const fl = s.flows;
    const anim = speed > 0 ? 1 : 0;

    for (const v of this.wells.values()) {
      if (!v.beam) continue;
      const w = s.wells.find((x) => x.id === v.id);
      const wf = w ? fl.wells[w.id] : undefined;
      const running = !!(w && wf && w.status === 'active' && !w.job && wf.liquid > 0.5);
      const util = running ? Math.max(0.25, Math.min(1, wf!.liquid / Math.max(1, wf!.liftCap))) : 0;
      v.phase += dt * Math.PI * 2 * 0.55 * util * anim;
      drawBeam(v.beam, v.phase);
    }

    this.drawFlowlines(s, anim);
    this.drawGauges(s);
    this.updateTrucks(s, dt * anim);
    this.updateFlare(s, dt);
    this.updateBeacons(s);
    this.drawSelection(s);
  }

  private drawFlowlines(s: GameState, anim: number): void {
    const g = this.flow;
    g.clear();
    const lineFor = (pad: number): [number, number][] => {
      const o = padOutlet(pad);
      return [o, [o[0], MANIFOLD[1]], MANIFOLD];
    };
    for (const f of s.fields) {
      if (!f.developed || f.padIndex < 0) continue;
      const pts = lineFor(f.padIndex).map(([x, y]) => iso(x + 0.3, y + 0.3, 2));
      g.moveTo(pts[0][0], pts[0][1]);
      for (const p of pts.slice(1)) g.lineTo(p[0], p[1]);
      g.stroke({ width: 4, color: 0x24201b });
      g.moveTo(pts[0][0], pts[0][1] - 1);
      for (const p of pts.slice(1)) g.lineTo(p[0], p[1] - 1);
      g.stroke({ width: 1.2, color: 0x6a6258, alpha: 0.8 });
      let liquid = 0;
      for (const w of s.wells) if (w.fieldId === f.id) liquid += s.flows.wells[w.id]?.liquid ?? 0;
      if (liquid > 1) this.flowDots(g, pts, this.time * 40 * anim * Math.min(2, 0.4 + liquid / 800), 0xffa040);
    }
    if (s.facilities.pipeline > 0) {
      const a = iso(PIPELINE.x, PIPELINE.y0, 6), b = iso(PIPELINE.x, PIPELINE.y1, 6);
      g.moveTo(a[0], a[1]).lineTo(b[0], b[1]).stroke({ width: 7, color: 0x2e2a25 });
      g.moveTo(a[0], a[1] - 2).lineTo(b[0], b[1] - 2).stroke({ width: 2, color: 0x7a7266 });
      for (let y = PIPELINE.y0 + 1; y < PIPELINE.y1; y += 2) {
        const p = iso(PIPELINE.x, y, 0);
        g.rect(p[0] - 3, p[1] - 6, 6, 6).fill({ color: 0x3a342c });
      }
      if (s.flows.soldPipe > 0) this.flowDots(g, [a, b], this.time * 50 * anim, 0xffb050);
    }
  }

  private flowDots(g: Graphics, pts: [number, number][], offset: number, color: number): void {
    const spacing = 26;
    let acc = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
      const len = Math.hypot(x1 - x0, y1 - y0);
      let d = ((offset - acc) % spacing + spacing) % spacing;
      for (; d < len; d += spacing) {
        const t = d / len;
        g.circle(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t - 1, 1.6).fill({ color, alpha: 0.9 });
      }
      acc += len;
    }
  }

  private drawGauges(s: GameState): void {
    const g = this.gauges;
    g.clear();
    const fill = s.flows.storageCap > 0 ? s.storage / s.flows.storageCap : 0;
    for (const t of this.tankSpots) {
      const [x, y] = iso(t.x - t.r * 0.72, t.y + t.r * 0.72, 4);
      const h = t.h - 8;
      g.rect(x - 2, y - h, 4, h).fill({ color: 0x1a1612, alpha: 0.8 });
      g.rect(x - 1.2, y - h * fill, 2.4, h * fill).fill({ color: fill > 0.9 ? 0xe0553a : 0xe8a23a });
    }
  }

  private updateTrucks(s: GameState, dt: number): void {
    const moving = s.flows.sold > 0;
    const n = this.trucks.length;
    for (let i = 0; i < n; i++) {
      const tr = this.trucks[i];
      if (moving) tr.t = (tr.t + dt * 0.05) % 1;
      // 0..0.5 driving out on the near lane, 0.5..1 coming back on the far lane.
      const outbound = tr.t < 0.5;
      const k = outbound ? tr.t * 2 : (1 - tr.t) * 2;
      const gx = ROAD.x0 + 0.6 + k * (ROAD.x1 - ROAD.x0 + 4);
      const gy = ROAD.y + (outbound ? 0.38 : -0.38);
      const [x, y] = iso(gx, gy);
      tr.sprite.position.set(x, y);
      tr.sprite.zIndex = depth(gx, gy) + 1;
      tr.out.visible = outbound;
      tr.back.visible = !outbound;
      tr.sprite.alpha = Math.max(0, Math.min(1, (ROAD.x1 - 6 - gx) / 6));
    }
  }

  private updateFlare(s: GameState, dt: number): void {
    const gas = s.flows.gasFlared;
    const size = gas > 0.5 ? 0.35 + Math.min(1.4, Math.sqrt(gas) / 18) : 0.12;
    const t = this.time;
    this.flames.forEach((f, i) => {
      const flick = 0.85 + 0.15 * Math.sin(t * (9 + i * 3.1)) + 0.1 * Math.sin(t * 23.7 + i);
      const base = [1.6, 1.0, 0.55][i];
      f.scale.set(base * size * flick, base * size * flick * 1.35);
      f.alpha = gas > 0.5 ? 0.85 : 0.5;
    });
    const [fx, fy] = SPOTS.flare;
    const [x, y] = iso(fx, fy, FLARE_TIP_Z + 8);
    this.puffTimer -= dt;
    if (gas > 0.5 && this.puffTimer <= 0 && this.puffs.length < 40) {
      this.puffTimer = 0.18;
      const p = new Sprite(this.bank.smoke);
      p.anchor.set(0.5);
      p.tint = 0x2a2622;
      p.position.set(x + (Math.random() - 0.5) * 6, y - 10 * size);
      p.scale.set(0.3 + size * 0.2);
      p.alpha = 0.5;
      this.root.addChildAt(p, this.root.getChildIndex(this.fx));
      this.puffs.push({ s: p, life: 0, vx: 8 + Math.random() * 8, vy: -14 - Math.random() * 8 });
    }
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      p.life += dt;
      p.s.x += p.vx * dt;
      p.s.y += p.vy * dt;
      p.s.scale.set(p.s.scale.x + dt * 0.35);
      p.s.alpha = Math.max(0, 0.5 - p.life * 0.12);
      if (p.life > 4) {
        p.s.destroy();
        this.puffs.splice(i, 1);
      }
    }
  }

  private beacon(key: string, gx: number, gy: number, z: number, on: boolean, color = 0xff3a20): void {
    let b = this.beacons.get(key);
    if (!on) {
      if (b) { b.destroy(); this.beacons.delete(key); }
      return;
    }
    if (!b) {
      b = new Sprite(this.bank.glow);
      b.anchor.set(0.5);
      this.fx.addChild(b);
      this.beacons.set(key, b);
    }
    const [x, y] = iso(gx, gy, z);
    b.position.set(x, y);
    b.tint = color;
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 6);
    b.alpha = 0.35 + 0.65 * pulse;
    b.scale.set(0.5 + 0.25 * pulse);
  }

  private updateBeacons(s: GameState): void {
    const bn = s.flows.bottleneck;
    for (const k of ['separator', 'storage', 'water'] as const) {
      const spot = this.beaconSpots[k];
      if (spot) this.beacon(`bn-${k}`, spot[0], spot[1], spot[2], bn === k);
    }
    for (const v of this.wells.values()) {
      const w = s.wells.find((x) => x.id === v.id);
      const failed = w?.status === 'failed';
      const busy = !!w?.job;
      this.beacon(`w-${v.id}`, v.gx, v.gy, busy ? 50 : 40, failed || busy, failed ? 0xff3a20 : 0xffb030);
    }
    for (const key of [...this.beacons.keys()]) {
      if (key.startsWith('w-') && !this.wells.has(Number(key.slice(2)))) this.beacon(key, 0, 0, 0, false);
    }
  }

  private drawSelection(s: GameState): void {
    const g = this.overlay;
    g.clear();
    if (this.selectedWell === null) return;
    const v = this.wells.get(this.selectedWell);
    if (!v || !s.wells.some((w) => w.id === v.id)) return;
    const [x, y] = iso(v.gx, v.gy);
    const pulse = 1 + 0.08 * Math.sin(this.time * 5);
    g.ellipse(x, y, 34 * pulse, 17 * pulse).stroke({ width: 2, color: 0xffc04a, alpha: 0.9 });
    g.ellipse(x, y, 40 * pulse, 20 * pulse).stroke({ width: 1, color: 0xffc04a, alpha: 0.4 });
  }
}

/** Walking beam, horsehead, pitman arms and cranks for one pumpjack phase. */
function drawBeam(g: Graphics, phi: number): void {
  g.clear();
  const P = (x: number, y: number, z: number) => iso(x, y, z);
  const pivot = { x: -1.45, z: 72 };
  const th = -0.2 * Math.sin(phi);
  const fr = 1.5, bk = 1.2;
  const front = { x: pivot.x + Math.cos(th) * fr, z: pivot.z + Math.sin(th) * fr * ZT };
  const back = { x: pivot.x - Math.cos(th) * bk, z: pivot.z - Math.sin(th) * bk * ZT };
  const crank = { x: -2.62, z: 28 };
  const pin = { x: crank.x + Math.cos(phi) * 0.42, z: crank.z + Math.sin(phi) * 0.42 * ZT };
  const cw = { x: crank.x - Math.cos(phi) * 0.32, z: crank.z - Math.sin(phi) * 0.32 * ZT };

  const crankSide = (y: number) => {
    const a = P(cw.x, y, cw.z), b = P(pin.x, y, pin.z), c = P(crank.x, y, crank.z);
    g.moveTo(c[0], c[1]).lineTo(b[0], b[1]).stroke({ width: 3.2, color: 0x3b3e42 });
    g.moveTo(c[0], c[1]).lineTo(a[0], a[1]).stroke({ width: 9, color: 0x34373a });
    g.moveTo(c[0], c[1] - 1).lineTo(a[0], a[1] - 1).stroke({ width: 3, color: 0x55595d });
    const e = P(back.x, y * 0.6, back.z);
    g.moveTo(b[0], b[1]).lineTo(e[0], e[1]).stroke({ width: 2, color: 0x4a4e52 });
  };
  crankSide(-0.38);

  // Beam.
  const b0 = P(back.x, 0, back.z), b1 = P(front.x, 0, front.z);
  g.moveTo(b0[0], b0[1]).lineTo(b1[0], b1[1]).stroke({ width: 5, color: PALETTE.beam });
  g.moveTo(b0[0], b0[1] - 1.5).lineTo(b1[0], b1[1] - 1.5).stroke({ width: 1.5, color: 0xd08040, alpha: 0.7 });
  const pv = P(pivot.x, 0, pivot.z);
  g.circle(pv[0], pv[1], 3).fill({ color: 0x2c2c2c });
  const eq = P(back.x, 0, back.z);
  g.rect(eq[0] - 4, eq[1] - 2, 8, 4).fill({ color: 0x3b3e42 });

  // Horsehead: arc centred on the pivot so the bridle hangs straight.
  const pts: number[] = [];
  const R0 = fr + 0.08, R1 = fr - 0.28;
  for (let i = 0; i <= 8; i++) {
    const a = th + 0.12 - (i / 8) * 0.5;
    const p = P(pivot.x + Math.cos(a) * R0, 0, pivot.z + Math.sin(a) * R0 * ZT);
    pts.push(p[0], p[1]);
  }
  for (let i = 8; i >= 0; i--) {
    const a = th + 0.12 - (i / 8) * 0.5;
    const p = P(pivot.x + Math.cos(a) * R1, 0, pivot.z + Math.sin(a) * R1 * ZT);
    pts.push(p[0], p[1]);
  }
  g.poly(pts).fill({ color: PALETTE.head });
  // Bridle and polished rod.
  const aLow = th + 0.12 - 0.5;
  const hz = pivot.z + Math.sin(aLow) * R0 * ZT;
  const carrier = hz - 16;
  const t0 = P(0.05, 0, hz), t1 = P(0.05, 0, carrier), t2 = P(0, 0, 28);
  g.moveTo(t0[0], t0[1]).lineTo(t1[0], t1[1]).stroke({ width: 1, color: 0x1a1a1a });
  g.rect(t1[0] - 4, t1[1] - 1, 8, 2).fill({ color: 0x2a2a2a });
  g.moveTo(t1[0], t1[1]).lineTo(t2[0], t2[1]).stroke({ width: 1.6, color: 0xb8b8b0 });

  crankSide(0.38);
}
