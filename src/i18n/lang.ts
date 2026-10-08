import { en, type MsgKey } from './en';
import { ru } from './ru';

export type Lang = 'en' | 'ru';
export const LANGS: readonly Lang[] = ['en', 'ru'];

const DICTS: Record<Lang, Record<MsgKey, string>> = { en, ru };
const STORE_KEY = 'drawdown.lang';

/** Saved choice first, then the browser language. Kept apart from the game save. */
function detect(): Lang {
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (saved === 'en' || saved === 'ru') return saved;
  } catch {
    /* storage unavailable */
  }
  const nav = (globalThis.navigator?.language ?? 'en').toLowerCase();
  return nav.startsWith('ru') ? 'ru' : 'en';
}

let current: Lang = detect();

export function getLang(): Lang {
  return current;
}

export function setLang(lang: Lang): void {
  current = lang;
  try {
    localStorage.setItem(STORE_KEY, lang);
  } catch {
    /* storage unavailable */
  }
}

/** Raw template for a key in the current language. */
export function template(key: MsgKey): string {
  return DICTS[current][key] ?? en[key] ?? key;
}

// Plural forms in dictionaries are listed in this category order.
const CATEGORIES: Record<Lang, Intl.LDMLPluralRule[]> = {
  en: ['one', 'other'],
  ru: ['one', 'few', 'many', 'other'],
};
const rules = new Map<Lang, Intl.PluralRules>();

export function pluralForm(n: number, forms: string[]): string {
  let r = rules.get(current);
  if (!r) rules.set(current, (r = new Intl.PluralRules(current)));
  const i = CATEGORIES[current].indexOf(r.select(n));
  // Russian 'other' only covers fractions, which read like 'few' (1,5 суток).
  const idx = i < forms.length ? i : current === 'ru' ? 1 : forms.length - 1;
  return forms[Math.max(0, idx)] ?? forms[forms.length - 1];
}
