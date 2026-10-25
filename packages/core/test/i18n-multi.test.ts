import { afterEach, describe, expect, it } from 'vitest';
import { addLocaleMessages, formatDate, formatMessage, intlLocale, isChineseLocale, localeFromSystem, monthGrid, setLocale, startOfWeek, tr, weekOrder, weekStartsOn, weekdayLabel, buildHeatmap, currencyName, CURRENCIES } from '../src';

afterEach(() => setLocale('zh'));

describe('多语言（Rei 2026-10-25）', () => {
  it('系统语言 → 支持的语言；认不出用英文', () => {
    expect(localeFromSystem(['pt-PT'])).toBe('pt-BR');
    expect(localeFromSystem(['pt-BR'])).toBe('pt-BR');
    expect(localeFromSystem(['in-ID'])).toBe('id');
    expect(localeFromSystem(['id'])).toBe('id');
    expect(localeFromSystem(['es-MX'])).toBe('es');
    expect(localeFromSystem(['ja-JP'])).toBe('ja');
    expect(localeFromSystem(['de-AT'])).toBe('de');
    expect(localeFromSystem(['fr-CA'])).toBe('fr');
    expect(localeFromSystem(['ru'])).toBe('ru');
    expect(localeFromSystem(['zh-TW'])).toBe('zh');
    expect(localeFromSystem(['ko-KR', 'it-IT'])).toBe('en');
    expect(localeFromSystem(['ko-KR', 'de-DE'])).toBe('de');
    expect(localeFromSystem([])).toBe('en');
  });

  it('复数：按 Intl.PluralRules 选分支，# 换成数字，精确值优先', () => {
    const ru = '{n, plural, one {# задача} few {# задачи} many {# задач} other {# задачи}}';
    expect(formatMessage(ru, { n: 1 }, 'ru')).toBe('1 задача');
    expect(formatMessage(ru, { n: 3 }, 'ru')).toBe('3 задачи');
    expect(formatMessage(ru, { n: 5 }, 'ru')).toBe('5 задач');
    expect(formatMessage(ru, { n: 21 }, 'ru')).toBe('21 задача');
    expect(formatMessage('{n, plural, other {#件}}', { n: 1 }, 'ja')).toBe('1件');
    expect(formatMessage('{n, plural, =0 {Aucune} one {# tâche} other {# tâches}} · {x}', { n: 0, x: 'ok' }, 'fr')).toBe('Aucune · ok');
    expect(formatMessage('{n, plural, one {# tâche} other {# tâches}}', { n: 0 }, 'fr')).toBe('0 tâche');
    // trx：参数是元素占位，数字看 count
    expect(formatMessage('Faltan {n} {n, plural, one {día} other {días}}', { n: '\u0001n\u0001', count: 1 }, 'es')).toBe('Faltan \u0001n\u0001 día');
    expect(formatMessage('{a, plural, one {un {b}} other {# {b}s}}', { a: 2, b: 'x' }, 'en')).toBe('2 xs');
  });

  it('tr：注册过的语言用译文，缺的退回英文，英文也没有用中文', () => {
    addLocaleMessages('de', { 我的一天: 'Mein Tag' }, { 健康: 'Gesundheit' });
    setLocale('de');
    expect(tr('我的一天')).toBe('Mein Tag');
    expect(tr('今天')).toBe('Today'); // 德语没写 → 英文
    expect(tr('词典里没有的中文')).toBe('词典里没有的中文');
  });

  it('一周从哪天开始跟着地区：中文 / 德语 / 俄语周一，英文 / 巴西葡语 / 日语 / 印尼语周日', () => {
    expect(weekStartsOn('zh')).toBe(1);
    expect(weekStartsOn('de')).toBe(1);
    expect(weekStartsOn('ru')).toBe(1);
    expect(weekStartsOn('fr')).toBe(1);
    expect(weekStartsOn('es')).toBe(1);
    expect(weekStartsOn('en')).toBe(0);
    expect(weekStartsOn('pt-BR')).toBe(0);
    expect(weekStartsOn('ja')).toBe(0);
    expect(weekStartsOn('id')).toBe(0);
    expect(weekOrder('en')[0]).toBe(0);
    expect(weekOrder('de')[0]).toBe(1);
    // 2026-10-01 是周四
    setLocale('en');
    expect(startOfWeek('2026-10-01')).toBe('2026-09-27');
    expect(monthGrid('2026-10').indexOf('2026-10-01')).toBe(4);
    expect(buildHeatmap({ end: '2026-10-01', weeks: 1, ratioFor: () => null }).columns[0]![0]!.date).toBe('2026-09-27');
    setLocale('zh');
    expect(startOfWeek('2026-10-01')).toBe('2026-09-28');
    expect(monthGrid('2026-10').indexOf('2026-10-01')).toBe(3);
  });

  it('日期、星期、币种按语言写', () => {
    setLocale('ru');
    expect(intlLocale()).toBe('ru-RU');
    expect(formatDate('2026-10-15', { weekday: false })).toMatch(/15 окт/);
    expect(weekdayLabel(1, 'long')).toBe('понедельник');
    setLocale('ja');
    expect(formatDate('2026-10-15', { weekday: false })).toBe('10月15日');
    setLocale('de');
    expect(weekdayLabel(1, 'long')).toBe('Montag');
    const usd = CURRENCIES.find((c) => c.code === 'USD')!;
    expect(currencyName(usd)).toMatch(/US-Dollar/);
    setLocale('zh');
    expect(currencyName(usd)).toBe(usd.name);
  });

  it('农历只认中文', () => {
    expect(isChineseLocale('ja')).toBe(false);
    expect(isChineseLocale('zh')).toBe(true);
  });
});
