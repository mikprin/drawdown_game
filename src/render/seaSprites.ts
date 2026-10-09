import { CanvasSource, Texture } from 'pixi.js';
import { fbm, hash2, vnoise } from './noise';
import {
  bakeCropped, baker, box, cylH, cylV, disc, grime, iso, line3, rgb, type Baked,
} from './paint';
import { PALETTE } from './sprites';

/** Procedural art for the shelf: sea, jack-up legs and hull, deck modules, ships. Same rules as sprites.ts. */

/** Deck height above the water, px. */
export const DECK_Z = 96;
/** Hull depth below the deck, px. */
export const HULL_H = 22;
/** Leg height above the deck, px. */
export const LEG_TOP = 84;
/** Flare tip relative to the boom root on the deck corner (tiles, tiles, px). */
export const BOOM_TIP: [number, number, number] = [-2.9, 2.9, 74];

const LEG_COL = 0xc98f2c;
const HULL_COL = 0x4f5a62;
const DECK_COL = 0x6c6a62;

function big(): ReturnType<typeof baker> {
  return baker(900, 760, 400, 380);
}

// ---------- sea ----------

function tileCanvas(size: number, draw: (ctx: CanvasRenderingContext2D) => void): Texture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d')!);
  return new Texture({ source: new CanvasSource({ resource: c }) });
}

/** Short strokes along the iso x axis (screen slope 1:2), repeated across the edges so the tile wraps. */
function swellStrokes(
  ctx: CanvasRenderingContext2D, size: number, n: number, seed: number, style: (k: number) => string, width: number, maxLen: number,
): void {
  ctx.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const x = hash2(i, 1, seed) * size, y = hash2(i, 2, seed) * size;
    const len = maxLen * (0.35 + 0.65 * hash2(i, 3, seed));
    ctx.strokeStyle = style(hash2(i, 4, seed));
    ctx.lineWidth = width;
    for (const ox of [-size, 0, size])
      for (const oy of [-size, 0, size]) {
        ctx.beginPath();
        ctx.moveTo(x + ox - len, y + oy - len / 2);
        ctx.lineTo(x + ox + len, y + oy + len / 2);
        ctx.stroke();
      }
  }
}

/** Tileable dark water with long iso-aligned swell. */
export function seaTexture(): Texture {
  const S = 512;
  return tileCanvas(S, (ctx) => {
    const img = ctx.createImageData(S, S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const n = fbm((x / S) * 8, (y / S) * 8, 3, 4, 8);
        const g = vnoise(x * 0.5, y * 0.5, 5, S * 0.5);
        const k = 0.84 + (n - 0.5) * 0.45 + (g - 0.5) * 0.05;
        const i = (y * S + x) * 4;
        img.data[i] = 30 * k;
        img.data[i + 1] = 55 * k;
        img.data[i + 2] = 61 * k;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    swellStrokes(ctx, S, 70, 7, (k) => `rgba(8,18,22,${0.08 + k * 0.1})`, 5, 30);
    swellStrokes(ctx, S, 26, 8, (k) => `rgba(120,150,150,${0.03 + k * 0.05})`, 1.5, 18);
  });
}

/** Sparse light glints on transparent, drifted over the sea for shimmer. */
export function glintTexture(): Texture {
  const S = 256;
  return tileCanvas(S, (ctx) => swellStrokes(ctx, S, 34, 11, (k) => `rgba(180,210,205,${0.1 + k * 0.2})`, 1, 6));
}

// ---------- jack-up ----------

/** Square lattice leg section from z0 to z1 at the origin. */
function lattice(c: CanvasRenderingContext2D, z0: number, z1: number, col: number): void {
  const r = 0.42;
  const corners: [number, number][] = [[-r, -r], [r, -r], [r, r], [-r, r]];
  const chord = (i: number, w: number) => line3(c, [[corners[i][0], corners[i][1], z0], [corners[i][0], corners[i][1], z1]], w, col);
  const braceFace = (a: number, b: number, w: number) => {
    for (let z = z0; z < z1 - 1; z += 13) {
      const zt = Math.min(z1, z + 13);
      line3(c, [[corners[a][0], corners[a][1], z], [corners[b][0], corners[b][1], zt]], w, col, false);
      line3(c, [[corners[a][0], corners[a][1], zt], [corners[b][0], corners[b][1], zt]], w * 0.8, col, false);
    }
  };
  // Back faces, then front faces.
  chord(0, 1.8);
  braceFace(0, 1, 0.8);
  braceFace(3, 0, 0.8);
  chord(1, 2.2);
  chord(3, 2.2);
  braceFace(1, 2, 1.1);
  braceFace(2, 3, 1.1);
  chord(2, 2.6);
}

/** Leg below the hull, standing in the water. */
export function legLower(): Baked {
  const b = baker(160, 260, 80, 200);
  const c = b.ctx;
  lattice(c, -8, DECK_Z - HULL_H, LEG_COL);
  // Waterline: wet, darker steel at the bottom.
  const [x, y] = iso(0, 0, 0);
  const g = c.createLinearGradient(0, y - 18, 0, y + 6);
  g.addColorStop(0, 'rgba(10,20,22,0)');
  g.addColorStop(1, 'rgba(10,20,22,0.7)');
  c.globalCompositeOperation = 'source-atop';
  c.fillStyle = g;
  c.fillRect(x - 40, y - 18, 80, 30);
  c.globalCompositeOperation = 'source-over';
  grime(b, { seed: 201, dirt: 0.3, rust: 0.55, streak: 0.6 });
  return bakeCropped(b);
}

/** Leg above the deck, with the jacking house around its foot and a beacon cap. */
export function legUpper(): Baked {
  const b = baker(200, 340, 100, 300);
  const c = b.ctx;
  box(c, -0.7, -0.7, DECK_Z, 1.4, 1.4, 16, 0x5d646a, { top: 0x4f555a });
  lattice(c, DECK_Z + 16, DECK_Z + LEG_TOP, LEG_COL);
  box(c, -0.5, -0.5, DECK_Z + LEG_TOP, 1.0, 1.0, 4, 0x8a5a1c);
  grime(b, { seed: 203, dirt: 0.28, rust: 0.45, streak: 0.5 });
  return bakeCropped(b);
}

/** Hull and deck plate, w×h tiles, top at DECK_Z. Origin is the hull's back corner at sea level. */
export function hull(w: number, h: number, seed: number): Baked {
  const b = big();
  const c = b.ctx;
  box(c, 0, 0, DECK_Z - HULL_H, w, h, HULL_H, HULL_COL, { top: DECK_COL });
  // Deck plating seams.
  c.strokeStyle = 'rgba(20,18,14,0.25)';
  c.lineWidth = 0.6;
  for (let u = 1; u < w; u += 1.5) {
    const p = iso(u, 0.05, DECK_Z), q = iso(u, h - 0.05, DECK_Z);
    c.beginPath(); c.moveTo(p[0], p[1]); c.lineTo(q[0], q[1]); c.stroke();
  }
  for (let v = 1; v < h; v += 1.5) {
    const p = iso(0.05, v, DECK_Z), q = iso(w - 0.05, v, DECK_Z);
    c.beginPath(); c.moveTo(p[0], p[1]); c.lineTo(q[0], q[1]); c.stroke();
  }
  // Yellow safety line inside the deck edge.
  c.strokeStyle = rgb(0xd8b23a, 0.9, 0.75);
  c.lineWidth = 1.1;
  const e = 0.25;
  const pts = [iso(e, e, DECK_Z), iso(w - e, e, DECK_Z), iso(w - e, h - e, DECK_Z), iso(e, h - e, DECK_Z)];
  c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath(); c.stroke();
  // Hull side stripe and draft marks.
  c.strokeStyle = rgb(0xb84a26, 1, 0.8);
  c.lineWidth = 2;
  const s0 = iso(0, h, DECK_Z - 6), s1 = iso(w, h, DECK_Z - 6), s2 = iso(w, 0, DECK_Z - 6);
  c.beginPath(); c.moveTo(s0[0], s0[1]); c.lineTo(s1[0], s1[1]); c.lineTo(s2[0], s2[1]); c.stroke();
  // Light streaking: the deck is horizontal, rust runs down the hull sides only a little.
  grime(b, { seed, dirt: 0.3, rust: 0.28, streak: 0.12 });
  return bakeCropped(b);
}

/** Grating over the well bay: rows of 3 slots. */
export function wellbayGrate(rows: number): Baked {
  const b = big();
  const c = b.ctx;
  const w = 3.3, hh = 0.2 + rows * 0.95;
  box(c, 0, 0, DECK_Z, w, hh, 1.5, 0x3c3e40, { edge: false });
  c.strokeStyle = 'rgba(0,0,0,0.35)';
  c.lineWidth = 0.4;
  for (let u = 0.15; u < w; u += 0.18) {
    const p = iso(u, 0.05, DECK_Z + 1.5), q = iso(u, hh - 0.05, DECK_Z + 1.5);
    c.beginPath(); c.moveTo(p[0], p[1]); c.lineTo(q[0], q[1]); c.stroke();
  }
  return bakeCropped(b);
}

/** Living quarters with lifeboats and the helideck on the roof. Origin at its back corner. */
export function quarters(): Baked {
  const b = big();
  const c = b.ctx;
  const W = 2.6, H = 2.4, Z = DECK_Z;
  for (let i = 0; i < 3; i++) {
    box(c, 0, 0, Z + i * 17, W, H, 17, i === 2 ? 0xc9c1ae : 0xd8d0bd, { top: 0xa69d8a });
    // Window rows on both visible faces.
    for (let u = 0.25; u < W - 0.2; u += 0.42) {
      const q = [iso(u, H, Z + i * 17 + 7), iso(u + 0.24, H, Z + i * 17 + 7), iso(u + 0.24, H, Z + i * 17 + 13), iso(u, H, Z + i * 17 + 13)];
      c.beginPath(); q.forEach(([x, y], k) => (k ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath();
      c.fillStyle = 'rgba(32,44,50,0.9)'; c.fill();
    }
    for (let v = 0.25; v < H - 0.2; v += 0.42) {
      const q = [iso(W, v, Z + i * 17 + 7), iso(W, v + 0.24, Z + i * 17 + 7), iso(W, v + 0.24, Z + i * 17 + 13), iso(W, v, Z + i * 17 + 13)];
      c.beginPath(); q.forEach(([x, y], k) => (k ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath();
      c.fillStyle = 'rgba(32,44,50,0.85)'; c.fill();
    }
  }
  // Lifeboats on the left face.
  for (const u of [0.3, 1.4]) cylH(c, u, H + 0.25, Z + 18, 0.22, 0.9, 'x', 0xe0661e);
  // Helideck: octagon on struts, overhanging the back corner.
  const hz = Z + 51 + 8, cx = 1.0, cy = 1.0, r = 1.75;
  for (const [sx, sy] of [[0.2, 1.8], [1.8, 0.2], [2.2, 2.0]]) line3(c, [[sx, sy, Z + 51], [cx + (sx - cx) * 1.3, cy + (sy - cy) * 1.3, hz]], 1.6, 0x5a5e60);
  const oct: [number, number][] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    oct.push(iso(cx + Math.cos(a) * r, cy + Math.sin(a) * r, hz));
  }
  const ring = (pts: [number, number][], dz: number) => {
    c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x, y + dz) : c.moveTo(x, y + dz))); c.closePath();
  };
  ring(oct, 3);
  c.fillStyle = rgb(0x3d4240, 0.8); c.fill();
  ring(oct, 0);
  c.fillStyle = rgb(0x3f4c3e); c.fill();
  c.strokeStyle = rgb(0xe8e2d0, 1, 0.8); c.lineWidth = 0.9; c.stroke();
  disc(c, iso(cx, cy, hz), [r * 0.62 * 32, r * 0.62 * 16], [-r * 0.62 * 32, r * 0.62 * 16]);
  c.strokeStyle = rgb(0xe0c23a); c.lineWidth = 1.6; c.stroke();
  // The H.
  c.strokeStyle = rgb(0xf2ede0); c.lineWidth = 1.5;
  const H1 = (a: [number, number, number], bb: [number, number, number]) => {
    const p = iso(...a), q = iso(...bb);
    c.beginPath(); c.moveTo(p[0], p[1]); c.lineTo(q[0], q[1]); c.stroke();
  };
  H1([cx - 0.35, cy - 0.25, hz], [cx + 0.35, cy - 0.25, hz]);
  H1([cx - 0.35, cy + 0.25, hz], [cx + 0.35, cy + 0.25, hz]);
  H1([cx, cy - 0.25, hz], [cx, cy + 0.25, hz]);
  grime(b, { seed: 211, dirt: 0.28, rust: 0.25, streak: 0.55 });
  return bakeCropped(b);
}

export function crane(): Baked {
  const b = big();
  const c = b.ctx;
  const Z = DECK_Z;
  cylV(c, 0, 0, Z, 0.32, 34, 0xc9a038);
  box(c, -0.35, -0.45, Z + 34, 0.9, 0.9, 16, 0xd0a83a, { top: 0xb8922e });
  const base: [number, number, number] = [0.2, -0.2, Z + 42];
  const tip: [number, number, number] = [-2.2, -3.0, Z + 128];
  for (const off of [-0.18, 0.18]) line3(c, [[base[0] + off, base[1] - off, base[2]], [tip[0] + off * 0.3, tip[1] - off * 0.3, tip[2]]], 1.6, 0xd2aa3c);
  for (let i = 0; i < 8; i++) {
    const t0 = i / 8, t1 = (i + 1) / 8;
    const p = (t: number, o: number): [number, number, number] =>
      [base[0] + (tip[0] - base[0]) * t + o, base[1] + (tip[1] - base[1]) * t - o, base[2] + (tip[2] - base[2]) * t];
    line3(c, [p(t0, -0.15 * (1 - t0)), p(t1, 0.15 * (1 - t1))], 0.7, 0xd2aa3c, false);
  }
  line3(c, [tip, [tip[0], tip[1], Z + 60]], 0.6, 0x2a2a2a, false);
  box(c, tip[0] - 0.1, tip[1] - 0.1, Z + 52, 0.2, 0.2, 8, 0x3a3a3a);
  grime(b, { seed: 221, dirt: 0.25, rust: 0.35, streak: 0.4 });
  return bakeCropped(b);
}

export function turbineSkid(): Baked {
  const b = big();
  const c = b.ctx;
  const Z = DECK_Z;
  box(c, 0, 0, Z, 1.7, 1.0, 4, PALETTE.steelDark);
  box(c, 0.05, 0.05, Z + 4, 1.6, 0.9, 24, 0x7f8486, { top: 0x6c7072 });
  c.strokeStyle = 'rgba(0,0,0,0.2)';
  c.lineWidth = 0.5;
  for (let u = 0.15; u < 1.6; u += 0.12) {
    const p = iso(u + 0.05, 0.95, Z + 5), q = iso(u + 0.05, 0.95, Z + 27);
    c.beginPath(); c.moveTo(p[0], p[1]); c.lineTo(q[0], q[1]); c.stroke();
  }
  cylV(c, 0.45, 0.45, Z + 28, 0.17, 26, 0x5a5a56, 0x1c1c1a);
  cylV(c, 1.15, 0.45, Z + 28, 0.14, 18, 0x5a5a56, 0x1c1c1a);
  grime(b, { seed: 231, dirt: 0.3, rust: 0.35, streak: 0.7 });
  return bakeCropped(b);
}

/** Produced-water treatment: hydrocyclones and a degasser on a skid. */
export function waterSkid(): Baked {
  const b = big();
  const c = b.ctx;
  const Z = DECK_Z;
  box(c, 0, 0, Z, 1.8, 0.9, 4, PALETTE.steelDark);
  for (let i = 0; i < 3; i++) cylV(c, 0.3 + i * 0.42, 0.45, Z + 4, 0.15, 18, 0x4d6f7c, 0x3a5560);
  cylV(c, 1.5, 0.45, Z + 4, 0.24, 24, PALETTE.water, 0x34515a);
  line3(c, [[0.15, 0.2, Z + 20], [1.6, 0.2, Z + 20]], 1.6, 0x8a8a84);
  grime(b, { seed: 241, dirt: 0.25, rust: 0.3, streak: 0.4 });
  return bakeCropped(b);
}

/** Flare boom from the deck corner out over the sea. Origin is the boom root at sea level. */
export function flareBoom(): Baked {
  const b = big();
  const c = b.ctx;
  const Z = DECK_Z;
  const [tx, ty, tz] = BOOM_TIP;
  // Lateral offset perpendicular to the boom, which runs along (−1, +1).
  const p = (t: number, o: number): [number, number, number] => [tx * t + o, ty * t + o, Z + tz * t];
  for (const o of [-0.18, 0.18]) line3(c, [p(0, o), p(1, o * 0.4)], 1.8, 0x8b8b85);
  line3(c, [[0, 0, Z + 4], [tx, ty, Z + tz - 8]], 1.4, 0x8b8b85);
  for (let i = 0; i < 9; i++) {
    const t0 = i / 9, t1 = (i + 1) / 9;
    line3(c, [p(t0, -0.18 * (1 - t0 * 0.6)), p(t1, 0.18 * (1 - t1 * 0.6))], 0.7, 0x9a9a92, false);
  }
  cylV(c, tx, ty, Z + tz - 4, 0.16, 8, 0x3a3a38);
  for (let i = 0; i < 2; i++) cylV(c, tx, ty, Z + tz - 14 + i * 5, 0.13, 3, i ? 0xd8d4c8 : 0xb03a2a);
  grime(b, { seed: 251, dirt: 0.25, rust: 0.35, streak: 0.4 });
  return bakeCropped(b);
}

// ---------- ships ----------

/** Shuttle tanker, 8 tiles long; dir 1 = bow toward +x. Origin at mid-ship on the waterline. */
export function tanker(dir: 1 | -1): Baked {
  const b = baker(760, 380, 380, 230);
  const c = b.ctx;
  const L = 8, B = 0.8, Fz = 15;
  const X = (x: number) => x * dir;
  const sternX = X(-L / 2), bowX = X(L / 2);
  // Hull: a box with a pointed bow, drawn as projected polygons.
  const bowLen = 1.4;
  const hullPts = (z: number): [number, number][] => [
    iso(sternX, -B, z), iso(X(L / 2 - bowLen), -B, z), iso(bowX, 0, z), iso(X(L / 2 - bowLen), B, z), iso(sternX, B, z),
  ];
  const fillPoly = (pts: [number, number][], col: string) => {
    c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath();
    c.fillStyle = col; c.fill();
  };
  // Visible sides: the +y side always; the +x end (bow or stern) depending on direction.
  const side = (y: number, x0: number, x1: number, z0: number, z1: number, col: string) =>
    fillPoly([iso(x0, y, z0), iso(x1, y, z0), iso(x1, y, z1), iso(x0, y, z1)], col);
  const xs = dir === 1 ? [sternX, X(L / 2 - bowLen)] : [X(L / 2 - bowLen), sternX];
  side(B, Math.min(...xs), Math.max(...xs), 0, 5, rgb(0x7a2a1e));
  side(B, Math.min(...xs), Math.max(...xs), 5, Fz, rgb(0x2a2c2e));
  // Bow faces.
  const bowSide = (z0: number, z1: number, col: string) =>
    fillPoly([iso(X(L / 2 - bowLen), B, z0), iso(bowX, 0, z0), iso(bowX, 0, z1), iso(X(L / 2 - bowLen), B, z1)], col);
  bowSide(0, 5, rgb(0x6a241a));
  bowSide(5, Fz, rgb(0x232527));
  // Heading toward −x the flat stern faces the camera.
  if (dir === -1) fillPoly([iso(sternX, -B, 0), iso(sternX, B, 0), iso(sternX, B, Fz), iso(sternX, -B, Fz)], rgb(0x26282a));
  // Deck.
  fillPoly(hullPts(Fz), rgb(0x5a6a58));
  // Pipe rack along the centreline and the manifold.
  line3(c, [[X(-L / 2 + 1.8), 0, Fz + 3], [X(L / 2 - 1.2), 0, Fz + 3]], 2, 0x8a8a7a);
  box(c, X(0) - 0.3, -0.5, Fz, 0.6, 1.0, 5, 0x9a8a5a);
  // Superstructure at the stern.
  const sx = dir === 1 ? sternX + 0.2 : sternX - 1.5;
  box(c, sx, -0.7, Fz, 1.3, 1.4, 26, 0xe2dccb, { top: 0xc8c0ad });
  box(c, sx + 0.1, -0.75, Fz + 26, 1.1, 1.5, 7, 0xe8e2d0, { top: 0xbfb7a4 });
  for (let v = -0.5; v < 0.6; v += 0.3) {
    const q = [iso(sx + 1.3, v, Fz + 29), iso(sx + 1.3, v + 0.18, Fz + 29), iso(sx + 1.3, v + 0.18, Fz + 32), iso(sx + 1.3, v, Fz + 32)];
    c.beginPath(); q.forEach(([x, y], k) => (k ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath();
    c.fillStyle = 'rgba(30,40,46,0.9)'; c.fill();
  }
  cylV(c, sx + 0.45, 0, Fz + 33, 0.2, 12, 0x2e2e2c, 0x1a1a18);
  box(c, sx + 0.3, -0.21, Fz + 38, 0.32, 0.42, 3, 0xb03a2a, { edge: false });
  grime(b, { seed: 261 + dir, dirt: 0.28, rust: 0.35, streak: 0.6 });
  return bakeCropped(b);
}

export function supplyBoat(): Baked {
  const b = baker(300, 200, 150, 130);
  const c = b.ctx;
  box(c, -1.4, -0.45, 0, 2.8, 0.9, 9, 0xd85a1e, { top: 0x7a7a70 });
  box(c, 0.4, -0.4, 9, 0.9, 0.8, 14, 0xe6e0cf, { top: 0xbab3a0 });
  box(c, -1.2, -0.3, 9, 1.4, 0.6, 2, 0x5a5a52, { edge: false });
  grime(b, { seed: 271, dirt: 0.3, rust: 0.3, streak: 0.4 });
  return bakeCropped(b);
}

/** Offloading buoy for the shuttle tankers. */
export function buoy(): Baked {
  const b = baker(120, 120, 60, 90);
  const c = b.ctx;
  cylV(c, 0, 0, -2, 0.45, 8, 0xc8402a, 0xd8c040);
  cylV(c, 0, 0, 6, 0.1, 10, 0x6a6a64);
  grime(b, { seed: 281, dirt: 0.2, rust: 0.3, streak: 0.2 });
  return bakeCropped(b);
}

export interface SeaBank {
  sea: Texture;
  glint: Texture;
  legLower: Baked;
  legUpper: Baked;
  hulls: Baked[];
  grates: Baked[];
  quarters: Baked;
  crane: Baked;
  turbine: Baked;
  waterSkid: Baked;
  boom: Baked;
  tankerOut: Baked;
  tankerIn: Baked;
  supply: Baked;
  buoy: Baked;
}

export const DECK_SIZES: [number, number][] = [[12, 9], [13.5, 10], [15, 11]];

export function bakeSea(): SeaBank {
  return {
    sea: seaTexture(),
    glint: glintTexture(),
    legLower: legLower(),
    legUpper: legUpper(),
    hulls: DECK_SIZES.map(([w, h], i) => hull(w, h, 291 + i)),
    grates: [1, 2, 3, 4].map((r) => wellbayGrate(r)),
    quarters: quarters(),
    crane: crane(),
    turbine: turbineSkid(),
    waterSkid: waterSkid(),
    boom: flareBoom(),
    tankerOut: tanker(1),
    tankerIn: tanker(-1),
    supply: supplyBoat(),
    buoy: buoy(),
  };
}
