import { TIME } from './balance';

function compact(v: number, digits = 1): string {
  const a = Math.abs(v);
  if (a >= 1e9) return (v / 1e9).toFixed(digits + 1) + 'B';
  if (a >= 1e6) return (v / 1e6).toFixed(digits + 1) + 'M';
  if (a >= 1e4) return (v / 1e3).toFixed(0) + 'k';
  if (a >= 1e3) return (v / 1e3).toFixed(digits) + 'k';
  return v.toFixed(0);
}

export function fmtMoney(v: number): string {
  return (v < 0 ? '-$' : '$') + compact(Math.abs(v));
}

export function fmtBbl(v: number): string {
  return compact(v) + ' bbl';
}

export function fmtRate(v: number): string {
  return compact(v) + ' bbl/d';
}

export function fmtNum(v: number): string {
  return compact(v);
}

export function fmtPct(v: number, digits = 0): string {
  return (v * 100).toFixed(digits) + '%';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function fmtDate(day: number): string {
  const d = new Date(Date.UTC(TIME.startYear, 0, 1) + Math.floor(day) * 86_400_000);
  return `${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function fmtDays(d: number): string {
  if (d >= 365) return (d / 365).toFixed(1) + ' yr';
  if (d >= 1) return Math.ceil(d) + ' d';
  return '<1 d';
}
