import { afterEach, describe, expect, it } from 'vitest';
import { buyTech, drillWell } from '../src/game/actions';
import { fmtDate, fmtGas, fmtMoney, fmtRate } from '../src/game/format';
import { msg } from '../src/game/msg';
import { newGame } from '../src/game/newGame';
import { en } from '../src/i18n/en';
import { ru } from '../src/i18n/ru';
import { setLang, t, tm, type MsgKey } from '../src/i18n';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)(?::(\w+))?/g)].map((m) => `${m[1]}:${m[2] ?? ''}`).sort();

afterEach(() => setLang('en'));

describe('dictionaries', () => {
  it('use the same placeholders in every language', () => {
    for (const key of Object.keys(en) as MsgKey[]) {
      expect(placeholders(ru[key]), key).toEqual(placeholders(en[key]));
    }
  });

  it('give Russian plural forms for each category', () => {
    for (const [key, s] of Object.entries(ru)) {
      for (const m of s.matchAll(/\{\w+:plural:([^}]*)\}/g)) expect(m[1].split('|').length, key).toBe(3);
    }
  });
});

describe('t()', () => {
  it('formats params and nested messages', () => {
    expect(t('log.failure', { lift: msg('lift.esp.name'), well: 'Ash-2', cost: 98_000 }))
      .toBe('ESP failure on Ash-2 — well is down. Repair $98k.');
    setLang('ru');
    expect(t('log.failure', { lift: msg('lift.esp.name'), well: 'Ash-2', cost: 98_000 }))
      .toBe('Отказ: ЭЦН на Ash-2 — скважина стоит. Ремонт $98 тыс.');
  });

  it('picks Russian plural forms', () => {
    setLang('ru');
    expect(t('log.seismicDone', { kind: 2, leads: 1 })).toBe('Сейсмика 2D обработана: найдена 1 структура.');
    expect(t('log.seismicDone', { kind: 2, leads: 3 })).toBe('Сейсмика 2D обработана: найдено 3 структуры.');
    expect(t('log.seismicDone', { kind: 2, leads: 5 })).toBe('Сейсмика 2D обработана: найдено 5 структур.');
    expect(t('log.seismicDone', { kind: 2, leads: 21 })).toBe('Сейсмика 2D обработана: найдена 21 структура.');
  });

  it('renders stored log entries in the current language', () => {
    const s = newGame(3);
    s.cash = 1e9;
    buyTech(s, 'wellPad');
    drillWell(s, 1);
    const name = s.wells[s.wells.length - 1].name;
    expect(tm(s.log[0].msg)).toBe(`Rig mobilised: spudding ${name}.`);
    setLang('ru');
    expect(tm(s.log[0].msg)).toBe(`Буровая на точке: начато бурение ${name}.`);
  });

  it('turns failure reasons into text and keeps the missing cash', () => {
    const s = newGame(3);
    s.cash = 0;
    const r = buyTech(s, 'wellPad', true);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.cost).toBe(120_000);
    expect(tm(r.reason)).toBe('Need $120k');
    const lock = buyTech(s, 'offshore', true);
    if (lock.ok) throw new Error('offshore should be locked');
    expect(tm(lock.reason)).toBe('Requires Exploration license, Waterflood');
  });
});

describe('formatting', () => {
  it('localises units, separators and dates', () => {
    expect(fmtMoney(1_250_000)).toBe('$1.25M');
    expect(fmtRate(1500)).toBe('1.5k bbl/d');
    expect(fmtGas(1000)).toBe('1.0k mcf/d');
    expect(fmtDate(31)).toBe('01 Feb 1985');
    setLang('ru');
    expect(fmtMoney(1_250_000)).toBe('$1,25 млн');
    expect(fmtRate(1500)).toBe('1500 барр./сут');
    expect(fmtRate(25_000)).toBe('25 тыс. барр./сут');
    expect(fmtGas(1000)).toBe('28 тыс. м³/сут');
    expect(fmtDate(31)).toBe('01 фев 1985');
  });
});
