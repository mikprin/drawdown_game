import { t } from '../i18n';

function fit(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth || Number(canvas.getAttribute('width')) || 100;
  const hgt = canvas.clientHeight || Number(canvas.getAttribute('height')) || 30;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(hgt * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(hgt * dpr);
    if (!canvas.style.width) {
      canvas.style.width = `${w}px`;
      canvas.style.height = `${hgt}px`;
    }
  }
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, hgt);
  return ctx;
}

export function sparkline(canvas: HTMLCanvasElement, data: number[], color: string): void {
  const ctx = fit(canvas);
  const w = canvas.width / Math.min(2, window.devicePixelRatio || 1);
  const hgt = canvas.height / Math.min(2, window.devicePixelRatio || 1);
  if (data.length < 2) return;
  const lo = Math.min(...data), hi = Math.max(...data);
  const span = Math.max(1e-6, hi - lo);
  ctx.beginPath();
  data.forEach((v, i) => {
    const x = (i / (data.length - 1)) * (w - 2) + 1;
    const y = hgt - 3 - ((v - lo) / span) * (hgt - 6);
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;
  ctx.stroke();
}

/** Oil (area) and water (line) rates over time — the decline curve, live. */
export function productionChart(canvas: HTMLCanvasElement, oil: number[], water: number[]): void {
  const ctx = fit(canvas);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.width / dpr, hgt = canvas.height / dpr;
  const pad = { l: 34, r: 4, t: 4, b: 12 };
  const n = oil.length;
  const max = Math.max(10, ...oil, ...water) * 1.1;
  ctx.font = '10px "IBM Plex Mono", monospace';
  ctx.fillStyle = '#6c6152';
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 3; i++) {
    const v = (max / 3) * i;
    const y = hgt - pad.b - (v / max) * (hgt - pad.t - pad.b);
    ctx.beginPath();
    ctx.moveTo(pad.l, y + 0.5);
    ctx.lineTo(w - pad.r, y + 0.5);
    ctx.stroke();
    ctx.fillText(v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0), 2, y + 3);
  }
  if (n < 2) {
    ctx.fillText(t('chart.collecting'), pad.l + 8, hgt / 2);
    return;
  }
  const X = (i: number) => pad.l + (i / (n - 1)) * (w - pad.l - pad.r);
  const Y = (v: number) => hgt - pad.b - (v / max) * (hgt - pad.t - pad.b);
  ctx.beginPath();
  ctx.moveTo(X(0), Y(0));
  oil.forEach((v, i) => ctx.lineTo(X(i), Y(v)));
  ctx.lineTo(X(n - 1), Y(0));
  ctx.closePath();
  const g = ctx.createLinearGradient(0, pad.t, 0, hgt - pad.b);
  g.addColorStop(0, 'rgba(232,162,58,0.45)');
  g.addColorStop(1, 'rgba(232,162,58,0.05)');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.beginPath();
  oil.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v))));
  ctx.strokeStyle = '#e8a23a';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.beginPath();
  water.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v))));
  ctx.strokeStyle = '#4fa3c7';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.fillStyle = '#6c6152';
  ctx.fillText(t('chart.days', { n }), pad.l, hgt - 1);
}
