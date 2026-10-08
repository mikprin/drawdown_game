import { Texture } from 'pixi.js';
import { fbm } from './noise';
import {
  bake, bakeCropped, baker, box, cylH, cylV, disc, grime, iso, line3, rgb, shadow, TH, TW, ZT,
  type Baked, type Baker,
} from './paint';

/**
 * Procedurally baked isometric sprites. Each returns a texture whose anchor is
 * the object's ground contact point. Swap any of these for hand-drawn art
 * without touching the scene code.
 */

function canvas(): Baker {
  return baker(480, 480, 240, 360);
}

export const PALETTE = {
  concrete: 0x8a8478,
  steelDark: 0x3d3f42,
  steel: 0x5c6064,
  beam: 0xa8581e,
  head: 0x2b2a28,
  tank: 0xb7b09f,
  vessel: 0x6b7a63,
  water: 0x3f5f6a,
  injBlue: 0x2f5f8a,
  rigRed: 0xb4532a,
  cabin: 0xcfc6b0,
};

// ---------- wells ----------

export function pumpjackBase(): Baked {
  const b = canvas();
  const c = b.ctx;
  shadow(c, -3.2, -0.8, 3.8, 1.6, 0.4);
  box(c, -3.25, -0.55, 0, 3.7, 1.1, 4, PALETTE.concrete);
  box(c, -3.05, -0.38, 4, 3.15, 0.76, 4, PALETTE.steelDark);
  // Motor and gearbox at the back.
  box(c, -3.55, -0.22, 8, 0.45, 0.44, 13, 0x3a5670);
  box(c, -2.98, -0.3, 8, 0.72, 0.6, 20, 0x4b4f53, { top: 0x55595d });
  // Samson post: two A-frames meeting at the saddle bearing.
  const legs: [number, number][] = [[-1.85, -0.34], [-0.95, -0.34], [-1.85, 0.34], [-0.95, 0.34]];
  for (const [x, y] of legs.slice(0, 2)) line3(c, [[x, y, 8], [-1.4, -0.08, 70]], 2.6, PALETTE.steel);
  line3(c, [[-1.75, -0.3, 30], [-1.05, -0.3, 30]], 1.4, PALETTE.steel, false);
  // Wellhead and stuffing box.
  cylV(c, 0, 0, 4, 0.14, 12, 0x6d6d6d);
  cylV(c, 0, 0, 16, 0.2, 3, 0x575757);
  cylV(c, 0, 0, 19, 0.09, 9, 0x7a7a7a);
  cylH(c, 0.12, -0.05, 9, 0.06, 0.7, 'x', 0x555555, false);
  for (const [x, y] of legs.slice(2)) line3(c, [[x, y, 8], [-1.4, 0.08, 70]], 2.6, PALETTE.steel);
  line3(c, [[-1.75, 0.3, 30], [-1.05, 0.3, 30]], 1.4, PALETTE.steel, false);
  grime(b, { seed: 11, dirt: 0.3, rust: 0.5, streak: 0.35 });
  return bakeCropped(b);
}

export type WellheadKind = 'flowing' | 'gaslift' | 'esp' | 'injector' | 'idle';

export function wellhead(kind: WellheadKind): Baked {
  const b = canvas();
  const c = b.ctx;
  const body = { flowing: 0x8f2a20, gaslift: 0x9a8424, esp: 0x6a6f74, injector: PALETTE.injBlue, idle: 0x5c5c58 }[kind];
  shadow(c, -0.7, -0.7, 1.4, 1.4, 0.3);
  box(c, -0.55, -0.55, 0, 1.1, 1.1, 3, PALETTE.concrete);
  if (kind === 'esp') {
    shadow(c, -1.7, -0.5, 0.8, 0.9, 0.3);
    box(c, -1.6, -0.35, 0, 0.5, 0.7, 34, 0x5d6a52, { top: 0x66735a });
    line3(c, [[-1.1, 0, 6], [-0.6, 0, 4], [-0.15, 0, 6]], 1.6, 0x1f1f1f, false);
  }
  cylV(c, 0, 0, 3, 0.16, 10, body);
  cylV(c, 0, 0, 13, 0.22, 4, 0x4f4f4f);
  cylV(c, 0, 0, 17, 0.13, 14, body);
  cylV(c, 0, 0, 31, 0.2, 3, 0x4f4f4f);
  cylV(c, 0, 0, 34, 0.09, 7, body);
  cylH(c, 0.12, -0.07, 19, 0.075, 0.55, 'x', body, false);
  // Hand wheels.
  const wheel = (gx: number, gy: number, z: number) => {
    disc(c, iso(gx, gy, z), [7, 0], [0, 3.2]);
    c.strokeStyle = rgb(0xc8b04a);
    c.lineWidth = 1.4;
    c.stroke();
  };
  wheel(0, 0, 24);
  wheel(0.55, -0.07, 24);
  if (kind === 'gaslift') {
    line3(c, [[0.25, 0.1, 22], [0.25, 0.95, 22], [0.25, 0.95, 2]], 2.2, 0xc9b13a);
    box(c, 0.05, 0.85, 0, 0.4, 0.4, 12, 0x6c6c66);
  }
  if (kind === 'injector') {
    line3(c, [[0.66, -0.07, 21], [1.0, -0.07, 21], [1.0, -0.07, 2]], 2.2, PALETTE.injBlue);
  }
  grime(b, { seed: 23, dirt: 0.25, rust: 0.4, streak: 0.3 });
  return bakeCropped(b);
}

// ---------- plant ----------

export function tank(r: number, h: number, seed: number): Baked {
  const b = canvas();
  const c = b.ctx;
  shadow(c, -r - 0.2, -r - 0.2, 2 * r + 0.6, 2 * r + 0.6, 0.45);
  box(c, -r - 0.15, -r - 0.15, 0, 2 * r + 0.3, 2 * r + 0.3, 2, PALETTE.concrete);
  cylV(c, 0, 0, 2, r, h, PALETTE.tank, 0x9c9586);
  // Weld seams.
  const [cx, cy] = iso(0, 0, 2);
  const rx = r * (TW / 2) * Math.SQRT2, ry = r * (TH / 2) * Math.SQRT2;
  c.strokeStyle = 'rgba(40,30,20,0.25)';
  c.lineWidth = 0.7;
  for (let z = 14; z < h - 4; z += 14) {
    c.beginPath();
    c.ellipse(cx, cy - z, rx, ry, 0, 0, Math.PI);
    c.stroke();
  }
  // Spiral stair on the visible side.
  const stair: [number, number, number][] = [];
  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    const a = Math.PI * (0.25 + 0.55 * t);
    stair.push([Math.cos(a) * (r + 0.08), Math.sin(a) * (r + 0.08), 2 + t * h]);
  }
  line3(c, stair, 1.6, 0x4a4a46, false);
  line3(c, stair.map(([x, y, z]) => [x * 1.06, y * 1.06, z + 7] as [number, number, number]), 0.8, 0x6a6a64, false);
  // Roof handrail and vent.
  c.beginPath();
  c.ellipse(cx, cy - h - 6, rx * 0.96, ry * 0.96, 0, 0, Math.PI);
  c.strokeStyle = 'rgba(70,70,64,0.9)';
  c.lineWidth = 0.8;
  c.stroke();
  cylV(c, -r * 0.3, -r * 0.3, h + 2, 0.08, 6, 0x6a6a64);
  grime(b, { seed, dirt: 0.3, rust: 0.35, streak: 0.8 });
  return bakeCropped(b);
}

export function separator(): Baked {
  const b = canvas();
  const c = b.ctx;
  shadow(c, -0.3, -0.5, 3.6, 1.4, 0.4);
  box(c, -0.2, -0.55, 0, 3.4, 1.1, 3, PALETTE.concrete);
  box(c, 0.3, -0.35, 3, 0.25, 0.7, 10, PALETTE.steelDark);
  box(c, 2.45, -0.35, 3, 0.25, 0.7, 10, PALETTE.steelDark);
  cylH(c, 0.1, 0, 8, 0.5, 2.8, 'x', PALETTE.vessel);
  cylV(c, 0.9, 0, 8 + ZT, 0.07, 10, 0x8a8a80);
  cylV(c, 2.0, 0, 8 + ZT, 0.1, 6, 0x9a3a2a);
  box(c, 1.2, 0.5, 3, 0.3, 0.2, 22, 0x4f5652);
  line3(c, [[3.0, 0, 26], [3.4, 0, 26], [3.4, 0, 4]], 2.2, 0x55554f);
  grime(b, { seed: 31, dirt: 0.3, rust: 0.35, streak: 0.5 });
  return bakeCropped(b);
}

export function waterTank(seed: number): Baked {
  const b = canvas();
  const c = b.ctx;
  shadow(c, -1, -1, 2.2, 2.2, 0.35);
  box(c, -0.95, -0.95, 0, 1.9, 1.9, 2, PALETTE.concrete);
  cylV(c, 0, 0, 2, 0.8, 46, PALETTE.water, 0x34515a);
  grime(b, { seed, dirt: 0.25, rust: 0.12, streak: 0.3 });
  return bakeCropped(b);
}

export function compressor(): Baked {
  const b = canvas();
  const c = b.ctx;
  shadow(c, -0.2, -0.2, 3, 2.2, 0.45);
  box(c, -0.1, -0.1, 0, 2.8, 2.0, 3, PALETTE.concrete);
  box(c, 0, 0, 3, 2.6, 1.8, 38, 0x7b7f80, { top: 0x6a6e70 });
  // Corrugation on both faces.
  c.strokeStyle = 'rgba(0,0,0,0.18)';
  c.lineWidth = 0.6;
  for (let x = 0.1; x < 2.6; x += 0.13) {
    const a = iso(x, 1.8, 3), bb = iso(x, 1.8, 41);
    c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(bb[0], bb[1]); c.stroke();
  }
  for (let y = 0.1; y < 1.8; y += 0.13) {
    const a = iso(2.6, y, 3), bb = iso(2.6, y, 41);
    c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(bb[0], bb[1]); c.stroke();
  }
  // Roll-up door.
  const d = [iso(0.6, 1.8, 3), iso(1.5, 1.8, 3), iso(1.5, 1.8, 28), iso(0.6, 1.8, 28)];
  c.beginPath(); d.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath();
  c.fillStyle = 'rgba(40,40,38,0.7)'; c.fill();
  box(c, 0.3, 0.3, 41, 1.2, 1.0, 10, 0x5a5e60);
  disc(c, iso(0.9, 0.8, 51), [14, 7], [-14, 7]);
  c.fillStyle = '#2a2c2e'; c.fill();
  cylV(c, 2.1, 0.4, 41, 0.12, 22, 0x4a4a48);
  grime(b, { seed: 41, dirt: 0.3, rust: 0.3, streak: 0.6 });
  return bakeCropped(b);
}

export function injectionSkid(): Baked {
  const b = canvas();
  const c = b.ctx;
  shadow(c, -0.2, -0.2, 2.8, 1.6, 0.4);
  box(c, 0, 0, 0, 2.6, 1.3, 5, PALETTE.steelDark);
  for (let i = 0; i < 3; i++) {
    box(c, 0.2 + i * 0.8, 0.25, 5, 0.55, 0.5, 14, PALETTE.injBlue);
    cylH(c, 0.25 + i * 0.8, 0.95, 5, 0.18, 0.45, 'x', 0x3a3e44, false);
  }
  line3(c, [[0.1, 0.5, 24], [2.5, 0.5, 24]], 2.6, 0x8a8a84);
  grime(b, { seed: 51, dirt: 0.25, rust: 0.3, streak: 0.3 });
  return bakeCropped(b);
}

export function swdPlant(): Baked {
  const b = canvas();
  const c = b.ctx;
  shadow(c, -0.3, -0.3, 2.6, 2, 0.4);
  box(c, -0.2, -0.2, 0, 2.4, 1.8, 3, PALETTE.concrete);
  box(c, 0, 0, 3, 1.3, 1.2, 26, 0x8d8a7c, { top: 0x6f6c62 });
  cylV(c, 1.8, 1.0, 3, 0.15, 12, PALETTE.injBlue);
  cylV(c, 1.8, 1.0, 15, 0.22, 4, 0x4f4f4f);
  line3(c, [[1.3, 0.6, 12], [1.8, 0.6, 12], [1.8, 0.95, 12]], 2, 0x6a6a64);
  grime(b, { seed: 57, dirt: 0.3, rust: 0.4, streak: 0.5 });
  return bakeCropped(b);
}

export function flareStack(): Baked {
  const b = canvas();
  const c = b.ctx;
  shadow(c, -1.6, -0.6, 2.6, 1.4, 0.35);
  box(c, -1.7, -0.6, 0, 2.4, 1.2, 3, PALETTE.concrete);
  cylH(c, -1.6, -0.25, 3, 0.4, 1.1, 'x', 0x5f5f5a);
  // Guy wires.
  c.strokeStyle = 'rgba(200,200,190,0.45)';
  c.lineWidth = 0.5;
  for (const [x, y] of [[-2.5, -1.5], [2, -1.2], [-1, 2.2]]) {
    const a = iso(0, 0, 150), g = iso(x, y, 0);
    c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(g[0], g[1]); c.stroke();
  }
  cylV(c, 0, 0, 3, 0.13, 166, 0x8b8b85);
  // Aviation banding near the tip.
  for (let i = 0; i < 4; i++) cylV(c, 0, 0, 130 + i * 9, 0.135, 4.5, i % 2 ? 0xd8d4c8 : 0xb03a2a);
  cylV(c, 0, 0, 169, 0.17, 7, 0x3a3a38);
  grime(b, { seed: 61, dirt: 0.25, rust: 0.3, streak: 0.4 });
  return bakeCropped(b);
}

export const FLARE_TIP_Z = 178;

export function derrick(): Baked {
  const b = baker(480, 520, 240, 420);
  const c = b.ctx;
  shadow(c, -2.5, -1.5, 5, 3.5, 0.45);
  box(c, -2.8, 0.3, 0, 2, 1, 14, 0x5b5f63);
  box(c, -1.1, -1.1, 0, 2.2, 2.2, 16, 0x6a3a22);
  const H = 190, base = 0.95, top = 0.22;
  const corner = (sx: number, sy: number, t: number): [number, number, number] => {
    const k = base + (top - base) * t;
    return [sx * k, sy * k, 16 + t * (H - 16)];
  };
  const drawFace = (a: [number, number], bb: [number, number], w: number) => {
    line3(c, [corner(a[0], a[1], 0), corner(a[0], a[1], 1)], w, PALETTE.rigRed);
    line3(c, [corner(bb[0], bb[1], 0), corner(bb[0], bb[1], 1)], w, PALETTE.rigRed);
    for (let i = 0; i < 9; i++) {
      const t0 = i / 9, t1 = (i + 1) / 9;
      line3(c, [corner(a[0], a[1], t1), corner(bb[0], bb[1], t1)], 0.9, PALETTE.rigRed, false);
      line3(c, [corner(a[0], a[1], t0), corner(bb[0], bb[1], t1)], 0.6, PALETTE.rigRed, false);
    }
  };
  // Back faces first, then front faces.
  drawFace([-1, -1], [1, -1], 1.6);
  drawFace([-1, -1], [-1, 1], 1.6);
  drawFace([1, -1], [1, 1], 2.2);
  drawFace([-1, 1], [1, 1], 2.2);
  box(c, -0.3, -0.3, H, 0.6, 0.6, 10, 0x6a6a64);
  box(c, -0.55, -0.55, H * 0.62, 1.1, 0.4, 2, 0x6a6a64, { edge: false });
  box(c, 1.3, -1.1, 0, 1.6, 1.0, 24, PALETTE.cabin);
  grime(b, { seed: 71, dirt: 0.25, rust: 0.35, streak: 0.3 });
  return bakeCropped(b);
}

export function truck(dir: 1 | -1): Baked {
  const b = canvas();
  const c = b.ctx;
  shadow(c, -1.4, -0.45, 2.9, 0.9, 0.4);
  const cabX = dir === 1 ? 1.0 : -1.65;
  const wheels = [-1.1, -0.55, 0.9];
  const wheel = (x: number, y: number) => {
    disc(c, iso(x, y, 4.5), [0.16 * 32, 0.16 * 16], [0, -0.16 * ZT]);
    c.fillStyle = '#1b1b1a';
    c.fill();
  };
  for (const x of wheels) wheel(dir === 1 ? x : -x, -0.38);
  box(c, -1.3, -0.35, 4, 2.6, 0.7, 4, 0x2b2b2a);
  cylH(c, dir === 1 ? -1.3 : -0.55, -0.02, 6, 0.33, 1.75, 'x', 0xb9bcbe);
  box(c, cabX, -0.36, 4, 0.65, 0.72, 20, 0xa13a24, { top: 0xb04a32 });
  // Windscreen.
  const fx = dir === 1 ? cabX + 0.65 : cabX;
  const ws = [iso(fx, -0.3, 14), iso(fx, 0.3, 14), iso(fx, 0.3, 21), iso(fx, -0.3, 21)];
  if (dir === 1) {
    c.beginPath(); ws.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath();
    c.fillStyle = 'rgba(30,40,45,0.85)'; c.fill();
  }
  for (const x of wheels) wheel(dir === 1 ? x : -x, 0.38);
  grime(b, { seed: 81 + dir, dirt: 0.3, rust: 0.15, streak: 0.2 });
  return bakeCropped(b);
}

export function cabin(): Baked {
  const b = canvas();
  const c = b.ctx;
  shadow(c, -0.2, -0.2, 2.8, 1.5, 0.4);
  box(c, 0, 0, 0, 2.6, 1.2, 4, 0x3a3a38);
  box(c, 0, 0, 4, 2.6, 1.2, 24, PALETTE.cabin, { top: 0xa8a090 });
  for (const x of [0.3, 1.1, 1.9]) {
    const w = [iso(x, 1.2, 12), iso(x + 0.45, 1.2, 12), iso(x + 0.45, 1.2, 22), iso(x, 1.2, 22)];
    c.beginPath(); w.forEach(([px, py], i) => (i ? c.lineTo(px, py) : c.moveTo(px, py))); c.closePath();
    c.fillStyle = 'rgba(35,45,50,0.9)'; c.fill();
  }
  box(c, 1.6, 0.3, 28, 0.5, 0.5, 8, 0x8a8a84);
  grime(b, { seed: 91, dirt: 0.35, rust: 0.2, streak: 0.5 });
  return bakeCropped(b);
}

export function bush(seed: number): Baked {
  const b = baker(80, 60, 40, 45);
  const c = b.ctx;
  for (let i = 0; i < 9; i++) {
    const a = fbm(i * 1.7, seed, seed, 2) * Math.PI * 2;
    const rr = 4 + fbm(seed, i * 2.3, seed + 1, 2) * 8;
    const x = Math.cos(a) * rr * 1.4, y = Math.sin(a) * rr * 0.6;
    const r = 4 + fbm(i, seed * 0.3, seed + 2, 2) * 6;
    c.beginPath();
    c.arc(x, y - r * 0.6, r, 0, Math.PI * 2);
    c.fillStyle = rgb(0x4d5232, 0.7 + 0.5 * fbm(i * 0.9, seed, seed + 3, 2));
    c.fill();
  }
  grime(b, { seed, dirt: 0.5, rust: 0.1, streak: 0 });
  return bakeCropped(b);
}

export function glowTexture(): Texture {
  const b = baker(64, 64, 32, 32, 1);
  const g = b.ctx.createRadialGradient(0, 0, 0, 0, 0, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  b.ctx.fillStyle = g;
  b.ctx.fillRect(-32, -32, 64, 64);
  return bake(b).texture;
}

export function smokeTexture(): Texture {
  const b = baker(64, 64, 32, 32, 1);
  const img = b.ctx.createImageData(64, 64);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const dx = (x - 32) / 32, dy = (y - 32) / 32;
      const r = Math.sqrt(dx * dx + dy * dy);
      const n = fbm(x * 0.08, y * 0.08, 5, 3);
      const a = Math.max(0, 1 - r) ** 1.5 * (0.5 + n);
      const i = (y * 64 + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.min(255, a * 200);
    }
  }
  b.ctx.putImageData(img, 0, 0);
  return bake(b).texture;
}

export interface SpriteBank {
  pumpjack: Baked;
  wellhead: Record<WellheadKind, Baked>;
  tankS: Baked;
  tankM: Baked;
  tankL: Baked;
  separator: Baked;
  waterTank: Baked;
  compressor: Baked;
  injection: Baked;
  swd: Baked;
  flare: Baked;
  derrick: Baked;
  truckOut: Baked;
  truckIn: Baked;
  cabin: Baked;
  bushes: Baked[];
  glow: Texture;
  smoke: Texture;
}

export function bakeAll(): SpriteBank {
  return {
    pumpjack: pumpjackBase(),
    wellhead: {
      flowing: wellhead('flowing'), gaslift: wellhead('gaslift'), esp: wellhead('esp'),
      injector: wellhead('injector'), idle: wellhead('idle'),
    },
    tankS: tank(0.85, 46, 101),
    tankM: tank(1.15, 62, 102),
    tankL: tank(1.5, 74, 103),
    separator: separator(),
    waterTank: waterTank(111),
    compressor: compressor(),
    injection: injectionSkid(),
    swd: swdPlant(),
    flare: flareStack(),
    derrick: derrick(),
    truckOut: truck(1),
    truckIn: truck(-1),
    cabin: cabin(),
    bushes: [bush(1), bush(2), bush(3), bush(4)],
    glow: glowTexture(),
    smoke: smokeTexture(),
  };
}
