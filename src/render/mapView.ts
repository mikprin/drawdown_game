import { Container, Graphics, Rectangle, Sprite, Text } from 'pixi.js';
import { EXPLORATION } from '../game/balance';
import {
  blockOf, cellAt, cosEstimate, heatEstimate, leadSizeEstimate, leadVisible, mapOf, regionalHint,
} from '../game/explore';
import { fmtNum } from '../game/format';
import type { Exploration, GameState, MapId } from '../game/types';
import { getLang, t as tr } from '../i18n';
import { fbm, vnoise } from './noise';
import { bake, baker, spriteOf } from './paint';

export const CELL = 40;

/** Land: plain, hills, marsh, lake. Shelf: coast, shallow, mid shelf, outer shelf, slope. */
const TERRAIN_COL = [
  [104, 92, 62],
  [122, 104, 74],
  [70, 84, 58],
  [44, 66, 78],
  [112, 100, 70],
  [58, 104, 112],
  [42, 84, 100],
  [32, 64, 84],
  [20, 40, 58],
];
const TERRAIN_H = [0.42, 0.85, 0.25, 0.05, 0.7, 0.3, 0.2, 0.1, 0.0];

function bakeTerrain(ex: Exploration): Sprite {
  const W = ex.w * CELL, H = ex.h * CELL;
  const b = baker(W, H, 0, 0, 1);
  const img = b.ctx.createImageData(W, H);
  const hAt = (fx: number, fy: number) => {
    const x0 = Math.max(0, Math.min(ex.w - 1, Math.floor(fx))), y0 = Math.max(0, Math.min(ex.h - 1, Math.floor(fy)));
    const x1 = Math.min(ex.w - 1, x0 + 1), y1 = Math.min(ex.h - 1, y0 + 1);
    const tx = Math.max(0, Math.min(1, fx - x0)), ty = Math.max(0, Math.min(1, fy - y0));
    const v = (x: number, y: number) => TERRAIN_H[ex.cells[y * ex.w + x].terrain];
    return (v(x0, y0) * (1 - tx) + v(x1, y0) * tx) * (1 - ty) + (v(x0, y1) * (1 - tx) + v(x1, y1) * tx) * ty;
  };
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const fx = px / CELL - 0.5, fy = py / CELL - 0.5;
      const e = hAt(fx, fy) * 0.75 + fbm(px * 0.012, py * 0.012, 21, 4) * 0.35;
      const cx = Math.min(ex.w - 1, Math.floor(px / CELL)), cy = Math.min(ex.h - 1, Math.floor(py / CELL));
      const t = ex.cells[cy * ex.w + cx].terrain;
      const col = TERRAIN_COL[t];
      // Hillshade from the elevation gradient.
      const ex2 = hAt(fx + 0.05, fy) * 0.75 + fbm((px + 2) * 0.012, py * 0.012, 21, 4) * 0.35;
      const ey2 = hAt(fx, fy + 0.05) * 0.75 + fbm(px * 0.012, (py + 2) * 0.012, 21, 4) * 0.35;
      let k = 0.9 + (e - ex2) * 6 + (e - ey2) * 6;
      k += (vnoise(px * 0.6, py * 0.6, 4) - 0.5) * 0.1;
      // Contour lines on land; at sea, faint isobaths and a light ripple.
      const c = (e * 14) % 1;
      if (t >= 5) {
        if (c < 0.04) k *= 1.12;
        k += (vnoise(px * 0.15, py * 0.5, 9) - 0.5) * 0.08;
      } else if (c < 0.06 && t !== 3) k *= 0.72;
      const i = (py * W + px) * 4;
      img.data[i] = col[0] * k;
      img.data[i + 1] = col[1] * k;
      img.data[i + 2] = col[2] * k;
      img.data[i + 3] = 255;
    }
  }
  b.ctx.putImageData(img, 0, 0);
  // Grid.
  b.ctx.strokeStyle = 'rgba(20,16,10,0.25)';
  b.ctx.lineWidth = 1;
  for (let x = 0; x <= ex.w; x++) { b.ctx.beginPath(); b.ctx.moveTo(x * CELL + 0.5, 0); b.ctx.lineTo(x * CELL + 0.5, H); b.ctx.stroke(); }
  for (let y = 0; y <= ex.h; y++) { b.ctx.beginPath(); b.ctx.moveTo(0, y * CELL + 0.5); b.ctx.lineTo(W, y * CELL + 0.5); b.ctx.stroke(); }
  return spriteOf(bake(b));
}

function bakeFog(): Sprite {
  const S = EXPLORATION.block * CELL;
  const b = baker(S, S, 0, 0, 1);
  const img = b.ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const n = fbm(x * 0.03, y * 0.03, 99, 4, 0);
      const i = (y * S + x) * 4;
      const v = 20 + n * 26;
      img.data[i] = v * 1.05;
      img.data[i + 1] = v;
      img.data[i + 2] = v * 0.85;
      img.data[i + 3] = 225;
    }
  }
  b.ctx.putImageData(img, 0, 0);
  return spriteOf(bake(b));
}

function heatColor(v: number): number {
  if (v < 0.2) return 0x6f8a52;
  if (v < 0.35) return 0xc9a640;
  if (v < 0.5) return 0xe0782e;
  return 0xe8452a;
}

export class MapView {
  readonly root = new Container();
  onSelectCell: (x: number, y: number) => void = () => {};
  onHover: (cell: { x: number; y: number } | null, gx: number, gy: number) => void = () => {};
  isDragGesture: () => boolean = () => false;
  selected: { x: number; y: number } | null = null;

  private terrain: Sprite | null = null;
  private mapId: MapId | null = null;
  private heat = new Graphics();
  private fogLayer = new Container();
  private marks = new Graphics();
  private anim = new Graphics();
  private labelLayer = new Container();
  private cursor = new Graphics();
  private fogSprites: Container[] = [];
  private staticKey = '';
  private hover: { x: number; y: number } | null = null;
  private time = 0;
  private fogTex: Sprite | null = null;

  constructor() {
    this.root.addChild(this.heat, this.fogLayer, this.marks, this.labelLayer, this.anim, this.cursor);
    this.root.eventMode = 'static';
    this.root.on('pointermove', (e) => {
      const p = e.getLocalPosition(this.root);
      const x = Math.floor(p.x / CELL), y = Math.floor(p.y / CELL);
      this.hover = this.inBounds(x, y) ? { x, y } : null;
      this.onHover(this.hover, e.global.x, e.global.y);
    });
    this.root.on('pointerleave', () => {
      this.hover = null;
      this.onHover(null, 0, 0);
    });
    this.root.on('pointertap', (e) => {
      if (this.isDragGesture()) return;
      const p = e.getLocalPosition(this.root);
      const x = Math.floor(p.x / CELL), y = Math.floor(p.y / CELL);
      if (this.inBounds(x, y)) this.onSelectCell(x, y);
    });
  }

  private w = 0;
  private h = 0;

  private inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  size(): [number, number] {
    return [this.w * CELL, this.h * CELL];
  }

  /** Which map is on screen; `sync` swaps the baked terrain when it changes. */
  get map(): MapId {
    return this.mapId ?? 'land';
  }

  sync(s: GameState, map: MapId): void {
    if (map === 'shelf' && !s.shelf) map = 'land';
    const ex = mapOf(s, map);
    if (this.mapId !== map) {
      this.mapId = map;
      if (this.terrain) {
        this.terrain.texture.destroy(true);
        this.terrain.destroy();
      }
      this.w = ex.w;
      this.h = ex.h;
      this.terrain = bakeTerrain(ex);
      this.root.addChildAt(this.terrain, 0);
      this.root.hitArea = new Rectangle(0, 0, ex.w * CELL, ex.h * CELL);
      this.fogTex ??= bakeFog();
      this.staticKey = '';
    }
    const key = getLang() + map + ex.blocks.join('') + '|' + ex.cells.map((c) => c.drilled[0] + c.fieldId).join('') +
      '|' + s.fields.map((f) => `${f.id}${f.developed ? 1 : 0}${f.devJob ? 1 : 0}${f.abandoned ? 1 : 0}`).join(',');
    if (key === this.staticKey) return;
    this.staticKey = key;
    this.drawStatic(s, ex, map);
  }

  private drawStatic(s: GameState, ex: Exploration, map: MapId): void {
    const B = EXPLORATION.block;
    // Fog per unsurveyed block, tinted by the faint regional hint.
    for (const f of this.fogSprites) f.destroy();
    this.fogSprites = [];
    for (let blk = 0; blk < ex.blocks.length; blk++) {
      if (ex.blocks[blk] > 0) continue;
      const sp = new Sprite(this.fogTex!.texture);
      // Sea charts show the water depth; only the geology is fogged on the shelf.
      if (map === 'shelf') sp.alpha = 0.55;
      const bw = ex.w / B;
      sp.position.set((blk % bw) * B * CELL, Math.floor(blk / bw) * B * CELL);
      this.fogLayer.addChild(sp);
      this.fogSprites.push(sp);
      // Faint regional prior glowing through the fog.
      const hint = new Graphics();
      hint.rect(0, 0, B * CELL, B * CELL).fill({ color: 0xe8a23a, alpha: Math.min(0.22, regionalHint(ex, blk) * 0.45) });
      hint.position.copyFrom(sp.position);
      this.fogLayer.addChild(hint);
      this.fogSprites.push(hint);
    }

    const h = this.heat;
    h.clear();
    for (let y = 0; y < ex.h; y++) {
      for (let x = 0; x < ex.w; x++) {
        const v = heatEstimate(ex, x, y);
        const tr0 = cellAt(ex, x, y).terrain;
        if (v === null || tr0 === 3 || tr0 === 4) continue;
        h.rect(x * CELL, y * CELL, CELL, CELL).fill({ color: heatColor(v), alpha: 0.12 + Math.min(0.5, v * 0.9) });
      }
    }
    // Block borders.
    for (let bx = 0; bx <= ex.w; bx += B) h.moveTo(bx * CELL, 0).lineTo(bx * CELL, ex.h * CELL);
    for (let by = 0; by <= ex.h; by += B) h.moveTo(0, by * CELL).lineTo(ex.w * CELL, by * CELL);
    h.stroke({ width: 1.5, color: 0x0e0b08, alpha: 0.55 });

    for (const c of this.labelLayer.removeChildren()) c.destroy();
    const label = (text: string, x: number, y: number, color = 0xf2e6cc, size = 11) => {
      const t = new Text({
        text,
        style: { fontFamily: 'IBM Plex Mono, monospace', fontSize: size, fill: color, fontWeight: '600', stroke: { color: 0x0e0b08, width: 3 } },
      });
      t.resolution = 2;
      t.anchor.set(0.5, 0);
      t.position.set(x, y);
      this.labelLayer.addChild(t);
    };

    const m = this.marks;
    m.clear();
    // Hub, or the shore base on the shelf map.
    const hx = ex.hubX * CELL + CELL / 2, hy = ex.hubY * CELL + CELL / 2;
    m.rect(hx - 12, hy - 12, 24, 24).fill({ color: 0x2a2620 }).stroke({ width: 2, color: 0xe8a23a });
    m.rect(hx - 6, hy - 6, 12, 12).fill({ color: 0xe8a23a });
    label(tr(map === 'shelf' ? 'map.base' : 'map.hub'), hx, hy + 13, 0xe8a23a);
    if (map === 'shelf') {
      // Slope cells are out of a jack-up's reach: hatch them.
      for (let y = 0; y < ex.h; y++)
        for (let x = 0; x < ex.w; x++) {
          if (cellAt(ex, x, y).terrain !== 8) continue;
          for (let k = 0; k < CELL; k += 8) m.moveTo(x * CELL + k, y * CELL).lineTo(x * CELL, y * CELL + k);
        }
      m.stroke({ width: 1, color: 0x9ab8c8, alpha: 0.12 });
    }

    for (let y = 0; y < ex.h; y++) {
      for (let x = 0; x < ex.w; x++) {
        const c = cellAt(ex, x, y);
        const cx = x * CELL + CELL / 2, cy = y * CELL + CELL / 2;
        if (c.drilled === 'dry') {
          m.moveTo(cx - 7, cy - 7).lineTo(cx + 7, cy + 7).moveTo(cx + 7, cy - 7).lineTo(cx - 7, cy + 7)
            .stroke({ width: 2.5, color: 0x1a1612 });
          m.moveTo(cx - 6, cy - 6).lineTo(cx + 6, cy + 6).moveTo(cx + 6, cy - 6).lineTo(cx - 6, cy + 6)
            .stroke({ width: 1.2, color: 0x9a8f80 });
          continue;
        }
        if (c.fieldId > 0) {
          const f = s.fields.find((ff) => ff.id === c.fieldId)!;
          if (f.abandoned) {
            m.circle(cx, cy, 9).fill({ color: 0x1a1612 }).stroke({ width: 2, color: 0x8a8070 });
            m.moveTo(cx - 5, cy).lineTo(cx + 5, cy).stroke({ width: 2, color: 0x8a8070 });
            label(f.name, cx, cy + 11, 0x9a8f80, 10);
            continue;
          }
          if (f.offshore && (f.developed || f.devJob)) {
            // Platform: deck on four legs.
            const col = f.developed ? 0x8fbf5a : 0xe8a23a;
            m.rect(cx - 10, cy - 8, 20, 9).fill({ color: 0x1a1612 }).stroke({ width: 2, color: col });
            for (const lx of [-8, 8]) m.moveTo(cx + lx, cy + 1).lineTo(cx + lx, cy + 10).stroke({ width: 2, color: col });
            m.moveTo(cx + 2, cy - 8).lineTo(cx + 2, cy - 16).stroke({ width: 2, color: col });
            label(f.name, cx, cy + 11, f.developed ? 0xb9d98c : 0xffc46a, 10);
            continue;
          }
          if (f.developed) {
            m.circle(cx, cy, 10).fill({ color: 0x1a1612 }).stroke({ width: 2, color: 0x8fbf5a });
            m.moveTo(cx - 6, cy + 4).lineTo(cx, cy - 6).lineTo(cx + 6, cy + 4).stroke({ width: 2, color: 0x8fbf5a });
          } else {
            m.circle(cx, cy - 2, 7).fill({ color: 0x0a0806 }).stroke({ width: 2, color: 0xe8a23a });
            m.poly([cx - 7, cy - 1, cx, cy - 14, cx + 7, cy - 1]).fill({ color: 0x0a0806 });
          }
          label(f.name, cx, cy + 11, f.developed ? 0xb9d98c : 0xffc46a, 10);
          continue;
        }
        if (leadVisible(ex, x, y)) {
          const cos = cosEstimate(ex, x, y)!;
          m.circle(cx, cy, 9).stroke({ width: 2, color: 0xf2e6cc, alpha: 0.9 });
          m.circle(cx, cy, 3).fill({ color: 0xf2e6cc });
          label(`${Math.round(cos * 100)}%`, cx, cy + 9, 0xf2e6cc, 10);
          const size = leadSizeEstimate(ex, x, y);
          if (size) label(`~${fmtNum(size.p50)}`, cx, cy - 22, 0xc8b89a, 9);
        }
      }
    }
  }

  update(s: GameState, dt: number): void {
    this.time += dt;
    if (!this.mapId || (this.mapId === 'shelf' && !s.shelf)) return;
    const ex = mapOf(s, this.mapId);
    const B = EXPLORATION.block;
    const a = this.anim;
    a.clear();
    const bw = ex.w / B;
    for (const sv of ex.surveys) {
      const x0 = (sv.block % bw) * B * CELL, y0 = Math.floor(sv.block / bw) * B * CELL;
      const S = B * CELL;
      const prog = 1 - sv.daysLeft / sv.total;
      a.rect(x0 + 2, y0 + 2, S - 4, S - 4).stroke({ width: 2, color: 0x6fd0ff, alpha: 0.6 });
      const sweep = ((this.time * 0.6) % 1) * S;
      a.moveTo(x0 + sweep, y0).lineTo(x0 + sweep, y0 + S).stroke({ width: 2, color: 0x6fd0ff, alpha: 0.8 });
      a.rect(x0, y0 + S - 5, S * prog, 5).fill({ color: 0x6fd0ff, alpha: 0.9 });
    }
    if (ex.wildcat) {
      const cx = ex.wildcat.x * CELL + CELL / 2, cy = ex.wildcat.y * CELL + CELL / 2;
      const prog = 1 - ex.wildcat.daysLeft / ex.wildcat.total;
      const blink = 0.5 + 0.5 * Math.sin(this.time * 6);
      a.poly([cx - 8, cy + 9, cx, cy - 14, cx + 8, cy + 9]).stroke({ width: 2, color: 0xff9a30, alpha: 0.6 + 0.4 * blink });
      a.moveTo(cx - 5, cy + 2).lineTo(cx + 5, cy + 2).stroke({ width: 1.5, color: 0xff9a30 });
      a.arc(cx, cy, 16, -Math.PI / 2, -Math.PI / 2 + prog * Math.PI * 2).stroke({ width: 3, color: 0xffc04a });
    }

    const c = this.cursor;
    c.clear();
    if (this.hover) {
      const { x, y } = this.hover;
      const blk = blockOf(ex, x, y);
      const bx = (blk % bw) * B * CELL, by = Math.floor(blk / bw) * B * CELL;
      c.rect(bx, by, B * CELL, B * CELL).stroke({ width: 1.5, color: 0xf2e6cc, alpha: 0.35 });
      c.rect(x * CELL, y * CELL, CELL, CELL).stroke({ width: 1.5, color: 0xf2e6cc, alpha: 0.8 });
    }
    if (this.selected) {
      const { x, y } = this.selected;
      const pulse = 2 + Math.sin(this.time * 5);
      c.rect(x * CELL - pulse, y * CELL - pulse, CELL + pulse * 2, CELL + pulse * 2).stroke({ width: 2.5, color: 0xffc04a });
    }
  }
}
