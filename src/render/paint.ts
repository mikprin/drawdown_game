import { CanvasSource, Sprite, Texture } from 'pixi.js';
import { fbm, vnoise } from './noise';

/** Isometric tile size (2:1) and vertical pixels per world tile. */
export const TW = 64;
export const TH = 32;
export const ZT = 36;
/** Baked sprites are drawn at 2x for crisp zoom. */
export const RES = 2;

export function iso(gx: number, gy: number, z = 0): [number, number] {
  return [(gx - gy) * (TW / 2), (gx + gy) * (TH / 2) - z];
}

export interface Baker {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
  ox: number;
  oy: number;
  res: number;
}

/** A canvas of logical size w×h whose drawing origin is the ground anchor (ox, oy). */
export function baker(w: number, h: number, ox: number, oy: number, res = RES): Baker {
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(w * res);
  canvas.height = Math.ceil(h * res);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.setTransform(res, 0, 0, res, ox * res, oy * res);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  return { canvas, ctx, w, h, ox, oy, res };
}

export interface Baked {
  texture: Texture;
  ax: number;
  ay: number;
}

export function bake(b: Baker): Baked {
  const source = new CanvasSource({ resource: b.canvas, resolution: b.res });
  return { texture: new Texture({ source }), ax: b.ox / b.w, ay: b.oy / b.h };
}

export function spriteOf(baked: Baked): Sprite {
  const s = new Sprite(baked.texture);
  s.anchor.set(baked.ax, baked.ay);
  return s;
}

// ---------- colour ----------

export function rgb(c: number, k = 1, a = 1): string {
  const r = Math.min(255, Math.round(((c >> 16) & 255) * k));
  const g = Math.min(255, Math.round(((c >> 8) & 255) * k));
  const bl = Math.min(255, Math.round((c & 255) * k));
  return a === 1 ? `rgb(${r},${g},${bl})` : `rgba(${r},${g},${bl},${a})`;
}

export function mix(a: number, b: number, t: number): number {
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

// ---------- primitives (all coordinates in world tiles, z in px) ----------

function poly(ctx: CanvasRenderingContext2D, pts: [number, number][]): void {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

export interface BoxOpts {
  top?: number;
  edge?: boolean;
}

/** Axis-aligned box from (gx,gy,z0) with size sx×sy tiles and height h px. Lit from the left. */
export function box(
  ctx: CanvasRenderingContext2D, gx: number, gy: number, z0: number,
  sx: number, sy: number, h: number, color: number, opts: BoxOpts = {},
): void {
  const z1 = z0 + h;
  const left: [number, number][] = [iso(gx, gy + sy, z0), iso(gx + sx, gy + sy, z0), iso(gx + sx, gy + sy, z1), iso(gx, gy + sy, z1)];
  const right: [number, number][] = [iso(gx + sx, gy, z0), iso(gx + sx, gy + sy, z0), iso(gx + sx, gy + sy, z1), iso(gx + sx, gy, z1)];
  const top: [number, number][] = [iso(gx, gy, z1), iso(gx + sx, gy, z1), iso(gx + sx, gy + sy, z1), iso(gx, gy + sy, z1)];
  poly(ctx, left);
  ctx.fillStyle = rgb(color, 0.82);
  ctx.fill();
  poly(ctx, right);
  ctx.fillStyle = rgb(color, 0.6);
  ctx.fill();
  poly(ctx, top);
  ctx.fillStyle = rgb(opts.top ?? color, 1.05);
  ctx.fill();
  if (opts.edge !== false) {
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 0.6;
    poly(ctx, [iso(gx, gy + sy, z1), iso(gx + sx, gy + sy, z1), iso(gx + sx, gy, z1), iso(gx + sx, gy, z0), iso(gx + sx, gy + sy, z0), iso(gx, gy + sy, z0)]);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,240,220,0.18)';
    ctx.beginPath();
    const a = iso(gx, gy + sy, z1), b = iso(gx + sx, gy + sy, z1), c = iso(gx + sx, gy, z1);
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.lineTo(c[0], c[1]);
    ctx.stroke();
  }
}

/** Vertical cylinder centred at (gx,gy), radius r tiles, height h px. */
export function cylV(
  ctx: CanvasRenderingContext2D, gx: number, gy: number, z0: number,
  r: number, h: number, color: number, topColor?: number,
): void {
  const [cx, cy] = iso(gx, gy, z0);
  const rx = r * (TW / 2) * Math.SQRT2;
  const ry = r * (TH / 2) * Math.SQRT2;
  const g = ctx.createLinearGradient(cx - rx, 0, cx + rx, 0);
  g.addColorStop(0, rgb(color, 0.62));
  g.addColorStop(0.28, rgb(color, 1.08));
  g.addColorStop(0.55, rgb(color, 0.86));
  g.addColorStop(1, rgb(color, 0.45));
  ctx.beginPath();
  ctx.moveTo(cx - rx, cy - h);
  ctx.lineTo(cx - rx, cy);
  ctx.ellipse(cx, cy, rx, ry, 0, Math.PI, 0, true);
  ctx.lineTo(cx + rx, cy - h);
  ctx.closePath();
  ctx.fillStyle = g;
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx, cy - h, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = rgb(topColor ?? color, 1.0);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth = 0.6;
  ctx.stroke();
}

/** Horizontal vessel along the x or y axis, built from projected slices (painter's order). */
export function cylH(
  ctx: CanvasRenderingContext2D, gx: number, gy: number, z0: number,
  r: number, len: number, axis: 'x' | 'y', color: number, capRound = true,
): void {
  const steps = Math.max(12, Math.ceil(len * 14));
  const zc = z0 + r * ZT;
  const ring = (s: number, scale = 1): [number, number][] => {
    const pts: [number, number][] = [];
    for (let i = 0; i < 24; i++) {
      const th = (i / 24) * Math.PI * 2;
      const lat = Math.cos(th) * r * scale;
      const z = zc + Math.sin(th) * r * ZT * scale;
      pts.push(axis === 'x' ? iso(gx + s, gy + lat, z) : iso(gx + lat, gy + s, z));
    }
    return pts;
  };
  const [, yTop] = iso(gx, gy, zc + r * ZT);
  const [, yBot] = iso(gx, gy, zc - r * ZT);
  const grad = (dy: number) => {
    const g = ctx.createLinearGradient(0, yTop + dy, 0, yBot + dy + r * TH);
    g.addColorStop(0, rgb(color, 1.12));
    g.addColorStop(0.35, rgb(color, 0.95));
    g.addColorStop(1, rgb(color, 0.45));
    return g;
  };
  const capLen = capRound ? r * 0.6 : 0;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const s = -capLen + t * (len + 2 * capLen);
    let scale = 1;
    if (s < 0) scale = Math.sqrt(Math.max(0, 1 - (s / capLen) ** 2));
    else if (s > len) scale = Math.sqrt(Math.max(0, 1 - ((s - len) / capLen) ** 2));
    if (scale < 0.05) continue;
    const pts = ring(s, scale);
    poly(ctx, pts);
    const dy = axis === 'x' ? s * (TH / 2) : s * (TH / 2);
    ctx.fillStyle = grad(dy);
    ctx.fill();
  }
}

export function line3(
  ctx: CanvasRenderingContext2D, pts: [number, number, number][], width: number, color: number, highlight = true,
): void {
  const p = pts.map(([x, y, z]) => iso(x, y, z));
  ctx.beginPath();
  ctx.moveTo(p[0][0], p[0][1]);
  for (let i = 1; i < p.length; i++) ctx.lineTo(p[i][0], p[i][1]);
  ctx.strokeStyle = rgb(color, 0.7);
  ctx.lineWidth = width;
  ctx.stroke();
  if (highlight && width > 1.2) {
    ctx.beginPath();
    ctx.moveTo(p[0][0], p[0][1] - width * 0.25);
    for (let i = 1; i < p.length; i++) ctx.lineTo(p[i][0], p[i][1] - width * 0.25);
    ctx.strokeStyle = rgb(color, 1.15, 0.7);
    ctx.lineWidth = width * 0.35;
    ctx.stroke();
  }
}

/** Soft ground shadow cast toward screen-right (light from the left). */
export function shadow(ctx: CanvasRenderingContext2D, gx: number, gy: number, sx: number, sy: number, alpha = 0.35): void {
  const [cx, cy] = iso(gx + sx / 2, gy + sy / 2);
  const rx = ((sx + sy) / 2) * (TW / 2) * 0.95;
  const ry = rx * 0.5;
  const g = ctx.createRadialGradient(cx + rx * 0.25, cy, 0, cx + rx * 0.25, cy, rx);
  g.addColorStop(0, `rgba(10,6,2,${alpha})`);
  g.addColorStop(1, 'rgba(10,6,2,0)');
  ctx.save();
  ctx.translate(cx + rx * 0.25, cy);
  ctx.scale(1, ry / rx);
  ctx.translate(-(cx + rx * 0.25), -cy);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx + rx * 0.25, cy, rx, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export interface GrimeOpts {
  seed: number;
  dirt?: number;
  rust?: number;
  streak?: number;
}

/**
 * Weathering pass over everything drawn so far: blotchy dirt, rust patches and
 * vertical rust streaks. Only touches opaque pixels.
 */
export function grime(b: Baker, o: GrimeOpts): void {
  const { canvas, ctx } = b;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  const dirt = o.dirt ?? 0.25, rust = o.rust ?? 0.35, streak = o.streak ?? 0.4;
  const sc = 1 / b.res;
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const i = (y * canvas.width + x) * 4;
      if (d[i + 3] < 8) continue;
      const px = x * sc, py = y * sc;
      const n = fbm(px * 0.09, py * 0.09, o.seed, 3);
      const grain = vnoise(px * 0.9, py * 0.9, o.seed + 5);
      let k = 1 - dirt * (n - 0.5) * 1.6 - 0.08 * (grain - 0.5);
      let r = d[i] * k, g = d[i + 1] * k, bl = d[i + 2] * k;
      const rp = fbm(px * 0.06 + 40, py * 0.06, o.seed + 9, 3);
      const st = vnoise(px * 0.35, py * 0.025, o.seed + 13);
      let t = Math.max(0, (rp - 0.58) * 3) * rust + Math.max(0, (st - 0.62) * 2.6) * streak * (0.5 + rp);
      t = Math.min(0.85, t);
      if (t > 0) {
        const rr = 120 + 40 * grain, rg = 58 + 20 * grain, rb = 24;
        r = r * (1 - t) + rr * t * (0.7 + 0.4 * n);
        g = g * (1 - t) + rg * t * (0.7 + 0.4 * n);
        bl = bl * (1 - t) + rb * t;
      }
      d[i] = r;
      d[i + 1] = g;
      d[i + 2] = bl;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Tileable noise pattern canvas for large fills (ground, gravel, concrete). */
export function noisePattern(
  size: number, seed: number, base: number, variance: number, scale: number, speckle = 0, tint2?: number,
): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const period = Math.round(size * scale);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = fbm((x / size) * period, (y / size) * period, seed, 4, period);
      const g = vnoise(x * 0.5, y * 0.5, seed + 3, size / 2);
      let col = base;
      if (tint2 !== undefined) col = mix(base, tint2, Math.max(0, Math.min(1, (n - 0.4) * 2.2)));
      let k = 1 + variance * (n - 0.5) * 2 + 0.06 * (g - 0.5);
      if (speckle > 0) {
        const s = vnoise(x * 2, y * 2, seed + 7, size * 2);
        if (s > 1 - speckle) k *= 1.25;
        else if (s < speckle * 0.7) k *= 0.7;
      }
      const i = (y * size + x) * 4;
      img.data[i] = Math.min(255, ((col >> 16) & 255) * k);
      img.data[i + 1] = Math.min(255, ((col >> 8) & 255) * k);
      img.data[i + 2] = Math.min(255, (col & 255) * k);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Bake, trimming transparent margins so each sprite's canvas is tight. */
export function bakeCropped(b: Baker, pad = 2): Baked {
  const { canvas, ctx } = b;
  const { width: W, height: H } = canvas;
  const d = ctx.getImageData(0, 0, W, H).data;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (d[(y * W + x) * 4 + 3] > 4) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return bake(b);
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(W - 1, x1 + pad); y1 = Math.min(H - 1, y1 + pad);
  const out = document.createElement('canvas');
  out.width = x1 - x0 + 1;
  out.height = y1 - y0 + 1;
  out.getContext('2d')!.drawImage(canvas, -x0, -y0);
  const source = new CanvasSource({ resource: out, resolution: b.res });
  return {
    texture: new Texture({ source }),
    ax: (b.ox * b.res - x0) / out.width,
    ay: (b.oy * b.res - y0) / out.height,
  };
}

/** Ellipse spanned by two conjugate screen vectors (a projected circle). */
export function disc(
  ctx: CanvasRenderingContext2D, c: [number, number], u: [number, number], v: [number, number],
): void {
  ctx.beginPath();
  for (let i = 0; i <= 24; i++) {
    const t = (i / 24) * Math.PI * 2;
    const x = c[0] + u[0] * Math.cos(t) + v[0] * Math.sin(t);
    const y = c[1] + u[1] * Math.cos(t) + v[1] * Math.sin(t);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}
