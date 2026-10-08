import { TIME } from './balance';
import { getLang, template, type Lang } from '../i18n/lang';

// Numbers below this print in full. Russian abbreviations ("тыс.") are long, so they wait until 10k.
const FULL_BELOW: Record<Lang, number> = { en: 1e3, ru: 1e4 };
// The sim counts gas in mcf (and GOR in scf/bbl). Russian UI shows cubic metres.
const GAS_FACTOR: Record<Lang, number> = { en: 1, ru: 0.0283168 };

function dec(s: string): string {
  return s.replace('.', template('num.dec'));
}

function compact(v: number, digits = 1): string {
  const a = Math.abs(v);
  if (a >= 1e9) return dec((v / 1e9).toFixed(digits + 1)) + template('num.B');
  if (a >= 1e6) return dec((v / 1e6).toFixed(digits + 1)) + template('num.M');
  if (a < FULL_BELOW[getLang()]) return v.toFixed(0);
  if (a >= 1e4) return (v / 1e3).toFixed(0) + template('num.k');
  return dec((v / 1e3).toFixed(digits)) + template('num.k');
}

export function fmtMoney(v: number): string {
  return (v < 0 ? '-$' : '$') + compact(Math.abs(v));
}

/** Exact-ish dollar price, e.g. crude per barrel. */
export function fmtPrice(v: number): string {
  return '$' + dec(v.toFixed(2));
}

export function fmtBbl(v: number): string {
  return compact(v) + ' ' + template('unit.bbl');
}

export function fmtRate(v: number): string {
  return compact(v) + ' ' + template('unit.bpd');
}

/** Short rate for tight table cells: whole numbers up to 10k. */
export function fmtRateShort(v: number): string {
  return (Math.abs(v) < 1e4 ? v.toFixed(0) : compact(v)) + ' ' + template('unit.bpdShort');
}

export function fmtNum(v: number): string {
  return compact(v);
}

/** Gas volume per day in local units, number only. */
export function fmtGasNum(mcf: number): string {
  return compact(mcf * GAS_FACTOR[getLang()]);
}

export function fmtGas(mcf: number): string {
  return fmtGasNum(mcf) + ' ' + template('unit.gas');
}

export function fmtGor(scfPerBbl: number): string {
  const v = scfPerBbl * GAS_FACTOR[getLang()];
  return (v < 100 ? v.toFixed(0) : compact(v)) + ' ' + template('unit.gor');
}

export function fmtPct(v: number, digits = 0): string {
  return dec((v * 100).toFixed(digits)) + '%';
}

export function fmtDate(day: number): string {
  const d = new Date(Date.UTC(TIME.startYear, 0, 1) + Math.floor(day) * 86_400_000);
  const month = template('date.months').split(' ')[d.getUTCMonth()];
  return `${String(d.getUTCDate()).padStart(2, '0')} ${month} ${d.getUTCFullYear()}`;
}

export function fmtDays(d: number): string {
  if (d >= 365) return dec((d / 365).toFixed(1)) + ' ' + template('unit.year');
  if (d >= 1) return Math.ceil(d) + ' ' + template('unit.day');
  return '<1 ' + template('unit.day');
}
