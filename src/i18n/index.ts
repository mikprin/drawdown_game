import {
  fmtBbl, fmtDays, fmtGas, fmtMoney, fmtNum, fmtPct, fmtPrice, fmtRate,
} from '../game/format';
import type { Msg, MsgParams } from '../game/msg';
import type { MsgKey } from './en';
import { pluralForm, template } from './lang';

export { getLang, LANGS, setLang, type Lang } from './lang';
export type { MsgKey } from './en';

type HelpIdOf<K> = K extends `help.${infer I}.b` ? I : never;
/** Glossary entries: every `help.<id>.b` has a matching `help.<id>.t`. */
export type HelpId = HelpIdOf<MsgKey>;

const FORMATS: Record<string, (v: number) => string> = {
  money: fmtMoney,
  bbl: fmtBbl,
  rate: fmtRate,
  num: fmtNum,
  pct: (v) => fmtPct(v),
  pct1: (v) => fmtPct(v, 1),
  days: fmtDays,
  price: fmtPrice,
  gas: fmtGas,
};

const PLACEHOLDER = /\{(\w+)(?::(\w+))?(?::([^{}]*))?\}/g;

/** Translate a key. See en.ts for the placeholder syntax. */
export function t(key: MsgKey, params?: MsgParams): string {
  const s = template(key);
  if (!params) return s;
  const out = s.replace(PLACEHOLDER, (whole, name: string, fmt?: string, arg?: string) => {
    const v = params[name];
    if (v === undefined) return whole;
    if (Array.isArray(v)) return v.map(tm).join(', ');
    if (typeof v === 'object') return tm(v);
    if (fmt === 'plural') return pluralForm(Number(v), (arg ?? '').split('|')).replace('#', String(v));
    if (fmt && typeof v === 'number') return (FORMATS[fmt] ?? String)(v);
    return String(v);
  });
  // An abbreviation at the end of a sentence keeps one period: "$98 тыс." not "$98 тыс..".
  return out.replace(/(?<!\.)\.\.(?!\.)/g, '.');
}

/** Render a stored message (log entry, action failure reason). */
export function tm(m: Msg): string {
  return t(m.key, m.params);
}

export function helpTitle(id: HelpId): string {
  return t(`help.${id}.t`);
}

export function helpBody(id: HelpId): string {
  return t(`help.${id}.b`);
}
