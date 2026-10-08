import { baker, bake, iso, noisePattern, rgb, type Baked } from './paint';
import { HUB, PADS, PIPELINE, ROAD, SPOTS, WORLD, type PadRect } from './layout';
import { hash2 } from './noise';

let patterns: { dirt: HTMLCanvasElement; gravel: HTMLCanvasElement; road: HTMLCanvasElement } | null = null;

function getPatterns() {
  patterns ??= {
    dirt: noisePattern(256, 3, 0x6b5a3e, 0.22, 6, 0.04, 0x5d5b3b),
    gravel: noisePattern(256, 9, 0x8a8172, 0.12, 10, 0.25),
    road: noisePattern(256, 13, 0x7a6649, 0.15, 8, 0.12),
  };
  return patterns;
}

export interface GroundSpec {
  pads: number[];
  pond: boolean;
  pipeline: boolean;
}

export function groundKey(g: GroundSpec): string {
  return `${g.pads.join(',')}|${g.pond}|${g.pipeline}`;
}

function quad(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  const p = [iso(x, y), iso(x + w, y), iso(x + w, y + h), iso(x, y + h)];
  ctx.beginPath();
  p.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
  ctx.closePath();
}

function track(ctx: CanvasRenderingContext2D, pts: [number, number][], width: number, color: string): void {
  ctx.beginPath();
  pts.forEach(([x, y], i) => {
    const [px, py] = iso(x, y);
    if (i) ctx.lineTo(px, py);
    else ctx.moveTo(px, py);
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

function gravelArea(ctx: CanvasRenderingContext2D, r: PadRect, pat: CanvasPattern): void {
  quad(ctx, r.x - 0.25, r.y - 0.25, r.w + 0.5, r.h + 0.5);
  ctx.fillStyle = 'rgba(60,48,32,0.6)';
  ctx.fill();
  quad(ctx, r.x, r.y, r.w, r.h);
  ctx.fillStyle = pat;
  ctx.fill();
  ctx.strokeStyle = 'rgba(40,32,22,0.5)';
  ctx.lineWidth = 2;
  ctx.stroke();
}

export function bakeGround(spec: GroundSpec): Baked {
  const W = WORLD;
  const margin = 200;
  const b = baker(W * 64, W * 32 + margin * 2, W * 32, margin, 1);
  const c = b.ctx;
  const P = getPatterns();
  const dirt = c.createPattern(P.dirt, 'repeat')!;
  const gravel = c.createPattern(P.gravel, 'repeat')!;
  const road = c.createPattern(P.road, 'repeat')!;

  c.fillStyle = '#16120e';
  c.fillRect(-W * 32, -margin, W * 64, W * 32 + margin * 2);
  quad(c, 0, 0, W, W);
  c.fillStyle = dirt;
  c.fill();

  // Large-scale blotches so the steppe isn't uniform.
  for (let i = 0; i < 260; i++) {
    const gx = hash2(i, 1, 77) * W, gy = hash2(i, 2, 77) * W;
    const [x, y] = iso(gx, gy);
    const r = 40 + hash2(i, 3, 77) * 160;
    const kind = hash2(i, 4, 77);
    const col = kind < 0.4 ? '70,72,40' : kind < 0.75 ? '40,30,20' : '150,128,92';
    const a = kind < 0.75 ? 0.18 : 0.12;
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${col},${a})`);
    g.addColorStop(1, `rgba(${col},0)`);
    c.save();
    c.translate(x, y);
    c.scale(1, 0.5);
    c.translate(-x, -y);
    c.fillStyle = g;
    c.fillRect(x - r, y - r, r * 2, r * 2);
    c.restore();
  }

  // Dirt tracks from pads to the hub.
  for (const pi of spec.pads) {
    const p = PADS[pi];
    const out: [number, number] = [p.x + p.w / 2, p.y + p.h / 2];
    const pts: [number, number][] = [out, [out[0], 27.5], [28, 27.5]];
    track(c, pts, 26, 'rgba(120,100,70,0.35)');
    track(c, pts, 14, 'rgba(140,118,84,0.35)');
  }

  // Road to the refinery.
  quad(c, ROAD.x0, ROAD.y - 0.9, ROAD.x1 - ROAD.x0, 1.8);
  c.fillStyle = road;
  c.fill();
  for (const dy of [-0.55, -0.15, 0.15, 0.55]) {
    track(c, [[ROAD.x0, ROAD.y + dy], [ROAD.x1, ROAD.y + dy]], 3, 'rgba(50,38,26,0.35)');
  }

  if (spec.pipeline) {
    track(c, [[PIPELINE.x, PIPELINE.y0], [PIPELINE.x, PIPELINE.y1]], 22, 'rgba(70,56,38,0.45)');
  }

  gravelArea(c, { x: HUB.x0, y: HUB.y0, w: HUB.x1 - HUB.x0, h: HUB.y1 - HUB.y0 }, gravel);
  // Tank farm bund wall.
  quad(c, 25, 26.8, 8.4, 6);
  c.strokeStyle = 'rgba(150,128,96,0.9)';
  c.lineWidth = 7;
  c.stroke();
  c.strokeStyle = 'rgba(60,46,30,0.6)';
  c.lineWidth = 2;
  c.stroke();
  // Flare pad.
  gravelArea(c, { x: SPOTS.flare[0] - 2.2, y: SPOTS.flare[1] - 1.2, w: 3.4, h: 2.6 }, gravel);
  // Loading bay apron.
  quad(c, 32, 25.2, 2, 2.6);
  c.fillStyle = 'rgba(120,110,95,0.35)';
  c.fill();

  for (const pi of spec.pads) gravelArea(c, PADS[pi], gravel);

  if (spec.pond) {
    gravelArea(c, { x: 35.2, y: 21.6, w: 3, h: 2.4 }, gravel);
    const [px, py] = iso(39.5, 22.5);
    c.save();
    c.translate(px, py);
    c.scale(1, 0.5);
    c.beginPath();
    for (let i = 0; i <= 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      const rr = 62 + 12 * Math.sin(a * 3 + 1) + 6 * Math.cos(a * 5);
      if (i) c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      else c.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    c.closePath();
    c.fillStyle = rgb(0x6d5f45);
    c.fill();
    c.scale(0.86, 0.86);
    c.fillStyle = rgb(0x2a3c3c);
    c.fill();
    c.restore();
  }

  // Fade the world edge into darkness.
  const [cx, cy] = iso(W / 2, W / 2);
  c.save();
  c.translate(cx, cy);
  c.scale(1, 0.5);
  const R = W * 32 * 0.78;
  const g = c.createRadialGradient(0, 0, R * 0.62, 0, 0, R);
  g.addColorStop(0, 'rgba(22,18,14,0)');
  g.addColorStop(1, 'rgba(22,18,14,1)');
  c.fillStyle = g;
  c.fillRect(-R * 1.2, -R * 1.2, R * 2.4, R * 2.4);
  c.restore();

  return bake(b);
}
