import { Container, Graphics, Sprite, Text, TilingSprite } from 'pixi.js';
import { MODULES } from '../game/balance';
import { fmtRate } from '../game/format';
import { legDays, platformById, rigUser } from '../game/platform';
import { fieldById, fieldWells } from '../game/reservoir';
import type { GameState, Platform, Tanker, Well } from '../game/types';
import { t as tr } from '../i18n';
import { iso, spriteOf, type Baked } from './paint';
import { BOOM_TIP, DECK_SIZES, DECK_Z, bakeSea, type SeaBank } from './seaSprites';
import type { SpriteBank, WellheadKind } from './sprites';

/** World point the camera centres on when a platform is selected. */
export const DECK_FOCUS = iso(6.5, 4.5, DECK_Z);

const depth = (gx: number, gy: number) => (gx + gy) * 10;

/** Deck layout in tiles from the hull's back corner. Legs stay put when the deck grows. */
const LEGS: [number, number][] = [[0.8, 0.8], [11.2, 0.8], [0.8, 8.2], [11.2, 8.2]];
const SPOT = {
  quarters: [1.8, 0.4] as [number, number],
  separators: [[5.0, 0.8], [5.0, 2.0], [5.0, 3.2]] as [number, number][],
  tanks: [[1.7, 5.0], [3.1, 5.0], [1.7, 6.4]] as [number, number][],
  water: [[4.2, 4.6], [4.2, 5.7], [4.2, 6.8]] as [number, number][],
  injection: [[6.4, 4.6], [6.4, 5.7]] as [number, number][],
  gasInj: [6.5, 6.9] as [number, number],
  turbines: [[8.7, 5.7], [8.7, 7.0]] as [number, number][],
  crane: [2.6, 8.0] as [number, number],
  boom: [0.2, 6.9] as [number, number],
};
const slotPos = (i: number): [number, number] => [9.0 + (i % 3) * 1.0, 2.1 + Math.floor(i / 3) * 0.95];

/** Ship lanes at sea level, in front of the platform. Ships head off along +x. */
const BUOY: [number, number] = [9.5, 13];
const MOORED: [number, number] = [15, 14.2];
const ANCHOR: [number, number] = [21, 18];
const FAR = 40;
const SUPPLY: [number, number] = [2, 14];

type WellKind = WellheadKind | 'drill';

interface WellVis {
  id: number;
  root: Container;
  kind: WellKind;
  gx: number;
  gy: number;
}

interface ShipVis {
  out: Sprite;
  back: Sprite;
}

export class SeaView {
  readonly root = new Container();
  selectedWell: number | null = null;
  onSelectWell: (id: number) => void = () => {};
  isDragGesture: () => boolean = () => false;

  private sea!: SeaBank;
  private water: TilingSprite | null = null;
  private glint: TilingSprite | null = null;
  private seaFx = new Graphics();
  private ships = new Container();
  private legsLow = new Container();
  /** Hull and everything on deck; shifted down while the hull is jacked up or lowered. */
  private deck = new Container();
  private objects = new Container();
  private fx = new Container();
  private overlay = new Graphics();
  private label: Text;
  private hullSprite: Sprite | null = null;
  private key = '';
  private platformId: number | null = null;
  private wells = new Map<number, WellVis>();
  private derrick: Sprite | null = null;
  private derrickAt: [number, number] = [0, 0];
  private tankerVis: ShipVis[] = [];
  private supply: Sprite | null = null;
  private flames: Sprite[] = [];
  private boomRoot: [number, number] = [0, 0];
  private beacons = new Map<string, Sprite>();
  private beaconSpots: Record<string, [number, number, number]> = {};
  private time = 0;
  private lift = DECK_Z;

  constructor(private bank: SpriteBank) {
    this.objects.sortableChildren = true;
    this.ships.sortableChildren = true;
    this.fx.blendMode = 'add';
    this.deck.addChild(this.objects);
    this.label = new Text({
      text: '',
      style: { fontFamily: 'IBM Plex Mono, monospace', fontSize: 13, fill: 0xeadfc8, stroke: { color: 0x0a1214, width: 4 }, fontWeight: '600' },
    });
    this.label.resolution = 2;
    this.label.anchor.set(0.5, 1);
    this.root.addChild(this.seaFx, this.ships, this.legsLow, this.deck, this.fx, this.overlay, this.label);
  }

  focusPoint(): [number, number] {
    return DECK_FOCUS;
  }

  /** Sea sprites are baked on first use: most games reach the shelf late or never. */
  private ensureBank(): void {
    if (this.sea) return;
    this.sea = bakeSea();
    this.water = new TilingSprite({ texture: this.sea.sea, width: 9000, height: 6000 });
    this.water.position.set(-4500, -3000);
    this.glint = new TilingSprite({ texture: this.sea.glint, width: 9000, height: 6000 });
    this.glint.position.set(-4500, -3000);
    this.glint.blendMode = 'add';
    this.root.addChildAt(this.glint, 0);
    this.root.addChildAt(this.water, 0);
    for (const [gx, gy] of LEGS) {
      const sp = spriteOf(this.sea.legLower);
      const [x, y] = iso(gx, gy);
      sp.position.set(x, y);
      this.legsLow.addChild(sp);
    }
    this.supply = spriteOf(this.sea.supply);
    const [sx, sy] = iso(SUPPLY[0], SUPPLY[1]);
    this.supply.position.set(sx, sy);
    this.supply.zIndex = depth(SUPPLY[0], SUPPLY[1]);
    this.ships.addChild(this.supply);
    const buoy = spriteOf(this.sea.buoy);
    const [bx, by] = iso(BUOY[0], BUOY[1]);
    buoy.position.set(bx, by);
    buoy.zIndex = depth(BUOY[0], BUOY[1]);
    this.ships.addChild(buoy);
    for (const [tint, sc] of [[0xff5a10, 1.4], [0xff9a30, 0.9], [0xffe08a, 0.5]] as const) {
      const g = new Sprite(this.bank.glow);
      g.anchor.set(0.5, 0.75);
      g.tint = tint;
      g.scale.set(sc);
      this.fx.addChild(g);
      this.flames.push(g);
    }
  }

  private put(baked: Baked, gx: number, gy: number, scale = 1, z = DECK_Z, dz = 0): Sprite {
    const s = spriteOf(baked);
    const [x, y] = iso(gx, gy, z);
    s.position.set(x, y);
    s.scale.set(scale);
    s.zIndex = depth(gx, gy) + dz;
    this.objects.addChild(s);
    return s;
  }

  // ---------- sync with game state ----------

  sync(s: GameState, platformId: number | null): void {
    const p = platformId !== null ? platformById(s, platformId) : undefined;
    this.root.visible = !!p;
    if (!p) return;
    this.ensureBank();
    const f = fieldById(s, p.fieldId);
    const m = p.modules;
    const key = [p.id, p.deck, m.wellbay, m.separator, m.storage, m.waterTreat, m.injection, m.turbine, m.gasInj, !!f.devJob, !!p.decom].join('|');
    if (key !== this.key || this.platformId !== p.id) {
      this.key = key;
      if (this.platformId !== p.id) this.clearWells();
      this.platformId = p.id;
      this.buildDeck(p, !!f.devJob || !!p.decom);
    }
    this.syncWells(s, p);
    this.syncTankers(p);
    let oil = 0;
    for (const w of fieldWells(s, f.id)) oil += s.flows.wells[w.id]?.oil ?? 0;
    this.label.text = `${f.name.toUpperCase()} · ${f.devJob ? tr('sea.jacking') : p.decom ? tr('sea.decommissioning') : fmtRate(oil)}`;
    const [lx, ly] = iso(0, 0, DECK_Z + 150);
    this.label.position.set(lx, ly);
  }

  private clearWells(): void {
    for (const v of this.wells.values()) v.root.destroy({ children: true });
    this.wells.clear();
  }

  private buildDeck(p: Platform, bare: boolean): void {
    for (const c of this.objects.removeChildren()) if (!this.isWellRoot(c)) c.destroy();
    for (const v of this.wells.values()) this.objects.addChild(v.root);
    if (this.hullSprite) this.hullSprite.destroy();
    this.hullSprite = spriteOf(this.sea.hulls[p.deck]);
    this.deck.addChildAt(this.hullSprite, 0);
    this.beaconSpots = {};

    for (const [gx, gy] of LEGS) this.put(this.sea.legUpper, gx, gy, 1, 0, 2);
    this.put(this.sea.quarters, SPOT.quarters[0], SPOT.quarters[1], 1, 0).zIndex = depth(SPOT.quarters[0] + 1.3, SPOT.quarters[1] + 1.2);
    this.put(this.sea.crane, SPOT.crane[0], SPOT.crane[1], 1, 0);
    this.boomRoot = SPOT.boom;
    this.put(this.sea.boom, SPOT.boom[0], SPOT.boom[1], 1, 0).zIndex = depth(SPOT.boom[0] - 1, SPOT.boom[1] + 1);
    // Laydown on the deck extensions: containers and a pipe rack.
    if (p.deck >= 1) {
      this.put(this.bank.cabin, 12.2, 2.4, 0.7);
      this.put(this.bank.cabin, 6.0, 9.2, 0.7);
    }
    if (p.deck >= 2) {
      this.put(this.bank.cabin, 13.6, 4.2, 0.7);
      this.put(this.bank.cabin, 9.0, 10.1, 0.7);
    }
    const rows = Math.ceil(MODULES.wellbay.levels[p.modules.wellbay].value / 3);
    const grate = this.put(this.sea.grates[rows - 1], 8.6, 1.7, 1, 0);
    grate.zIndex = -1000;
    if (bare) return;

    const m = p.modules;
    for (let i = 0; i <= m.separator; i++) this.put(this.bank.separator, SPOT.separators[i][0], SPOT.separators[i][1], 0.95);
    this.beaconSpots.separator = [SPOT.separators[0][0] + 1.4, SPOT.separators[0][1], DECK_Z + 60];
    for (let i = 0; i <= m.storage; i++) this.put(this.bank.tankS, SPOT.tanks[i][0], SPOT.tanks[i][1], 0.7);
    this.beaconSpots.storage = [SPOT.tanks[0][0], SPOT.tanks[0][1], DECK_Z + 50];
    for (let i = 0; i <= m.waterTreat; i++) this.put(this.sea.waterSkid, SPOT.water[i][0], SPOT.water[i][1], 1, 0);
    this.beaconSpots.water = [SPOT.water[0][0] + 0.9, SPOT.water[0][1], DECK_Z + 40];
    for (let i = 0; i < m.injection; i++) this.put(this.bank.injection, SPOT.injection[i][0], SPOT.injection[i][1], 0.7);
    if (m.gasInj > 0) this.put(this.bank.compressor, SPOT.gasInj[0], SPOT.gasInj[1], m.gasInj > 1 ? 0.7 : 0.6);
    for (let i = 0; i < m.turbine; i++) this.put(this.sea.turbine, SPOT.turbines[i][0], SPOT.turbines[i][1], 1, 0);
  }

  private isWellRoot(c: unknown): boolean {
    for (const v of this.wells.values()) if (v.root === c) return true;
    return false;
  }

  private wellKind(w: Well): WellKind {
    if (w.job?.kind === 'drill') return 'drill';
    if (w.status === 'injector' || w.job?.kind === 'convert') return 'injector';
    return w.lift === 'rodpump' ? 'idle' : (w.lift as WellheadKind);
  }

  private syncWells(s: GameState, p: Platform): void {
    const seen = new Set<number>();
    for (const w of fieldWells(s, p.fieldId)) {
      seen.add(w.id);
      const kind = this.wellKind(w);
      let v = this.wells.get(w.id);
      if (v && v.kind !== kind) {
        v.root.destroy({ children: true });
        this.wells.delete(w.id);
        v = undefined;
      }
      if (!v) {
        const [gx, gy] = slotPos(w.slot);
        v = this.makeWell(w.id, kind, gx, gy);
        this.wells.set(w.id, v);
      }
    }
    for (const [id, v] of this.wells) {
      if (!seen.has(id)) {
        v.root.destroy({ children: true });
        this.wells.delete(id);
      }
    }
    // The single rig skids over whichever well it is working on.
    const user = rigUser(s, p.fieldId);
    this.derrickAt = user ? slotPos(user.slot) : slotPos(0);
    if (!this.derrick || this.derrick.destroyed) {
      this.derrick = spriteOf(this.bank.derrick);
      this.derrick.scale.set(0.85);
    }
    if (this.derrick.parent !== this.objects) this.objects.addChild(this.derrick);
    const fieldBuilt = fieldById(s, p.fieldId).developed;
    this.derrick.visible = fieldBuilt;
    const [dx, dy] = iso(this.derrickAt[0], this.derrickAt[1], DECK_Z);
    this.derrick.position.set(dx, dy);
    this.derrick.zIndex = depth(this.derrickAt[0], this.derrickAt[1]) + 6;
  }

  private makeWell(id: number, kind: WellKind, gx: number, gy: number): WellVis {
    const root = new Container();
    const [x, y] = iso(gx, gy, DECK_Z);
    root.position.set(x, y);
    root.zIndex = depth(gx, gy) + 5;
    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.on('pointertap', () => {
      if (!this.isDragGesture()) this.onSelectWell(id);
    });
    root.on('pointerover', () => { root.alpha = 0.85; });
    root.on('pointerout', () => { root.alpha = 1; });
    if (kind !== 'drill') {
      const sp = spriteOf(this.bank.wellhead[kind]);
      sp.scale.set(0.6);
      root.addChild(sp);
    } else {
      // Conductor stub while the rig is drilling: a clickable target under the derrick.
      const g = new Graphics();
      g.ellipse(0, 0, 9, 4.5).fill({ color: 0x2a2a28 }).stroke({ width: 1, color: 0x8a8a80 });
      root.addChild(g);
    }
    this.objects.addChild(root);
    return { id, root, kind, gx, gy };
  }

  private syncTankers(p: Platform): void {
    while (this.tankerVis.length < p.tankers.length) {
      const out = spriteOf(this.sea.tankerOut);
      const back = spriteOf(this.sea.tankerIn);
      this.ships.addChild(out, back);
      this.tankerVis.push({ out, back });
    }
    while (this.tankerVis.length > p.tankers.length) {
      const v = this.tankerVis.pop()!;
      v.out.destroy();
      v.back.destroy();
    }
  }

  // ---------- per-frame animation ----------

  update(s: GameState, dt: number, speed: number): void {
    const p = this.platformId !== null ? platformById(s, this.platformId) : undefined;
    if (!p || !this.root.visible || !this.sea) return;
    this.time += dt;
    const anim = speed > 0 ? 1 : 0;
    const storm = s.weather.storm > 0;
    const f = fieldById(s, p.fieldId);
    const pf = s.flows.platforms[p.id];

    // Swell drifts; a storm darkens it and doubles the pace.
    const drift = (storm ? 3 : 1) * dt * anim;
    this.water!.tilePosition.x += 6 * drift;
    this.water!.tilePosition.y += 3 * drift;
    this.glint!.tilePosition.x -= 10 * drift;
    this.glint!.tilePosition.y += 2 * drift;
    this.water!.tint = storm ? 0x8a98a0 : 0xffffff;
    this.glint!.alpha = storm ? 0.35 : 0.8 + 0.2 * Math.sin(this.time * 0.7);

    // Jacking: the hull climbs the legs while building and comes down when decommissioning.
    const job = f.devJob ?? p.decom;
    const prog = job ? 1 - job.daysLeft / job.total : 1;
    const target = f.devJob ? 24 + (DECK_Z - 24) * prog : p.decom ? DECK_Z - (DECK_Z - 24) * prog : DECK_Z;
    this.lift += (target - this.lift) * Math.min(1, dt * 3);
    this.deck.y = DECK_Z - this.lift;

    const bob = (k: number) => Math.sin(this.time * (storm ? 2.2 : 1.1) + k) * (storm ? 2.5 : 1);
    if (this.supply) this.supply.y = iso(SUPPLY[0], SUPPLY[1])[1] + bob(1);
    this.drawSeaFx(p, storm);
    this.updateTankers(s, p, bob);
    this.updateFlare(pf?.gasFlared ?? 0, p);
    this.updateBeacons(s, p);
    this.drawSelection(s);
  }

  private drawSeaFx(p: Platform, storm: boolean): void {
    const g = this.seaFx;
    g.clear();
    // Hull shadow on the water.
    const [W, H] = DECK_SIZES[p.deck];
    const sh = [iso(0.6, 0.6), iso(W + 0.6, 0.6), iso(W + 0.6, H + 0.6), iso(0.6, H + 0.6)];
    g.poly(sh.flat()).fill({ color: 0x050a0c, alpha: 0.28 });
    // Foam rings around the legs.
    for (const [gx, gy] of LEGS) {
      const [x, y] = iso(gx, gy);
      const k = 1 + 0.12 * Math.sin(this.time * 2 + gx);
      g.ellipse(x, y, 26 * k, 13 * k).stroke({ width: storm ? 3 : 2, color: 0xcfe0dc, alpha: storm ? 0.5 : 0.3 });
      g.ellipse(x, y, 18, 9).fill({ color: 0xcfe0dc, alpha: 0.08 });
    }
  }

  private shipAt(v: ShipVis, inbound: boolean, gx: number, gy: number, alpha: number, bob: number): void {
    const [x, y] = iso(gx, gy);
    const sp = inbound ? v.back : v.out;
    v.out.visible = !inbound && alpha > 0;
    v.back.visible = inbound && alpha > 0;
    sp.position.set(x, y + bob);
    sp.zIndex = depth(gx, gy);
    sp.alpha = alpha;
  }

  private updateTankers(s: GameState, p: Platform, bob: (k: number) => number): void {
    const leg = legDays(s, p);
    const hose = this.overlay;
    hose.clear();
    let anchorIdx = 0;
    p.tankers.forEach((tk: Tanker, i) => {
      const v = this.tankerVis[i];
      if (!v) return;
      const show = 0.3;
      switch (tk.state) {
        case 'moored': {
          this.shipAt(v, false, MOORED[0], MOORED[1], 1, bob(i));
          break;
        }
        case 'queued': {
          const [ax, ay] = [ANCHOR[0] + anchorIdx * 2, ANCHOR[1] - anchorIdx * 3];
          anchorIdx++;
          this.shipAt(v, true, ax, ay, 1, bob(i + 2));
          break;
        }
        case 'outbound': {
          const k = 1 - tk.daysLeft / leg;
          const a = k < show ? 1 - Math.max(0, (k / show - 0.7) / 0.3) : 0;
          this.shipAt(v, false, MOORED[0] + (k / show) * FAR, MOORED[1], a, bob(i));
          break;
        }
        case 'inbound': {
          const k = tk.daysLeft / leg;
          const a = k < show ? 1 - Math.max(0, (k / show - 0.7) / 0.3) : 0;
          this.shipAt(v, true, ANCHOR[0] + (k / show) * FAR, ANCHOR[1], a, bob(i));
          break;
        }
        case 'port':
          v.out.visible = v.back.visible = false;
          break;
      }
    });
    // Loading hose from the deck to the buoy and on to the moored tanker.
    const moored = p.tankers.some((tk) => tk.state === 'moored');
    if (moored) {
      const a = iso(8, DECK_SIZES[p.deck][1], DECK_Z - 18 - (DECK_Z - this.lift));
      const b = iso(BUOY[0], BUOY[1], 4);
      const c = iso(MOORED[0] - 3.6, MOORED[1] - 0.6, 12);
      hose.moveTo(a[0], a[1]).quadraticCurveTo((a[0] + b[0]) / 2, Math.max(a[1], b[1]) + 18, b[0], b[1]).lineTo(c[0], c[1])
        .stroke({ width: 2.2, color: 0x1a1a18, alpha: 0.9 });
    }
  }

  private updateFlare(gas: number, p: Platform): void {
    const z = this.lift;
    const [x, y] = iso(this.boomRoot[0] + BOOM_TIP[0], this.boomRoot[1] + BOOM_TIP[1], z + BOOM_TIP[2]);
    const size = gas > 0.5 ? 0.35 + Math.min(1.5, Math.sqrt(gas) / 22) : 0;
    const alive = !!p && gas > 0.5;
    this.flames.forEach((fl, i) => {
      const flick = 0.85 + 0.15 * Math.sin(this.time * (9 + i * 3.1)) + 0.1 * Math.sin(this.time * 23.7 + i);
      const base = [1.4, 0.9, 0.5][i];
      fl.position.set(x, y);
      fl.scale.set(base * size * flick, base * size * flick * 1.35);
      fl.visible = alive;
      fl.alpha = 0.85;
    });
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
    const [x, y] = iso(gx, gy, z - (DECK_Z - this.lift));
    b.position.set(x, y);
    b.tint = color;
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 6);
    b.alpha = 0.35 + 0.65 * pulse;
    b.scale.set(0.5 + 0.25 * pulse);
  }

  private updateBeacons(s: GameState, p: Platform): void {
    const pf = s.flows.platforms[p.id];
    const bn = pf?.bottleneck ?? 'none';
    for (const k of ['separator', 'storage', 'water'] as const) {
      const spot = this.beaconSpots[k];
      this.beacon(`bn-${k}`, spot?.[0] ?? 0, spot?.[1] ?? 0, spot?.[2] ?? 0, !!spot && bn === k);
    }
    const ids = new Set<number>();
    for (const v of this.wells.values()) {
      ids.add(v.id);
      const w = s.wells.find((x) => x.id === v.id);
      const failed = w?.status === 'failed';
      const busy = !!w?.job;
      this.beacon(`w-${v.id}`, v.gx, v.gy, DECK_Z + (busy ? 46 : 34), failed || busy, failed ? 0xff3a20 : 0xffb030);
    }
    for (const key of [...this.beacons.keys()]) {
      if (key.startsWith('w-') && !ids.has(Number(key.slice(2)))) this.beacon(key, 0, 0, 0, false);
    }
    // Aviation light on the derrick crown.
    const [dx, dy] = this.derrickAt;
    this.beacon('crown', dx, dy, DECK_Z + 140, !!this.derrick?.visible, 0xff2a10);
  }

  private drawSelection(s: GameState): void {
    const g = this.overlay;
    if (this.selectedWell === null) return;
    const v = this.wells.get(this.selectedWell);
    if (!v || !s.wells.some((w) => w.id === v.id)) return;
    const [x, y] = iso(v.gx, v.gy, DECK_Z - (DECK_Z - this.lift));
    const pulse = 1 + 0.08 * Math.sin(this.time * 5);
    g.ellipse(x, y, 22 * pulse, 11 * pulse).stroke({ width: 2, color: 0xffc04a, alpha: 0.9 });
    g.ellipse(x, y, 27 * pulse, 13.5 * pulse).stroke({ width: 1, color: 0xffc04a, alpha: 0.4 });
  }
}
