import { describe, expect, it } from 'vitest';
import { Store } from '../src/store';
import { MemoryAdapter } from '../src/storage/memory';
import { BUILTIN_TASK_TYPES, BUILTIN_TYPE_IDS as T } from '../src/seed/builtin-types';
import { seedDemo } from '../src/seed/demo';
import { CURRENCIES, formatMoney, moneyOf, parseMoney, recentCurrency, searchCurrencies } from '../src/money';
import { planFieldMigration } from '../src/library';
import { fieldText } from '../src/preview';
import type { LibraryItem, TaskType } from '../src/types';

const now = () => new Date('2026-10-15T12:00:00Z');
const shopping = BUILTIN_TASK_TYPES.find((t) => t.id === T.shopping)!;

describe('金额：币种、格式、识别', () => {
  it('币种表里有要求的这些，代码不重复', () => {
    const codes = CURRENCIES.map((c) => c.code);
    for (const c of ['CNY', 'USD', 'SGD', 'GBP', 'EUR', 'JPY', 'HKD', 'TWD', 'KRW', 'TRY', 'PHP', 'MYR', 'THB', 'AUD', 'CAD', 'CHF']) expect(codes).toContain(c);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes[0]).toBe('CNY');
  });

  it('搜币种：中文名、代码、符号、别名', () => {
    expect(searchCurrencies('美').map((c) => c.code)).toContain('USD');
    expect(searchCurrencies('usd').map((c) => c.code)).toEqual(['USD']);
    expect(searchCurrencies('里拉').map((c) => c.code)).toEqual(['TRY']);
    expect(searchCurrencies('菲律宾币').map((c) => c.code)).toEqual(['PHP']);
    expect(searchCurrencies('₱').map((c) => c.code)).toEqual(['PHP']);
    expect(searchCurrencies('')).toHaveLength(CURRENCIES.length);
  });

  it('显示按币种的小数位，整数不补 .00', () => {
    expect(formatMoney({ amount: 1299, currency: 'CNY' })).toBe('¥1,299');
    expect(formatMoney({ amount: 12.5, currency: 'USD' })).toBe('US$12.50');
    expect(formatMoney({ amount: 1200, currency: 'JPY' })).toBe('JP¥1,200');
    expect(formatMoney({ amount: 1200.4, currency: 'JPY' })).toBe('JP¥1,200');
    expect(formatMoney({ amount: 59.9, currency: 'GBP' })).toBe('£59.90');
    expect(formatMoney({ amount: 189, currency: 'SGD' })).toBe('S$189');
    expect(formatMoney({ amount: 1299.5, currency: 'TRY' })).toBe('₺1,299.50');
    expect(formatMoney({ amount: 500, currency: 'PHP' })).toBe('₱500');
    expect(formatMoney({ amount: 49, currency: 'MYR' })).toBe('RM49');
    expect(formatMoney({ amount: 99, currency: 'RUB' })).toBe('₽99');
    // 只有代码、表里也只写代码的照原样
    expect(formatMoney({ amount: 10, currency: 'CHF' })).toMatch(/^CHF\s10$/);
    expect(fieldText({ amount: 1299, currency: 'CNY' })).toBe('¥1,299');
  });

  it('识别旧价格：符号、代码、中文、千分位；没写币种算人民币；有认不出的字不猜', () => {
    expect(parseMoney('$12.5')).toEqual({ amount: 12.5, currency: 'USD' });
    expect(parseMoney('£30')).toEqual({ amount: 30, currency: 'GBP' });
    expect(parseMoney('¥1,299')).toEqual({ amount: 1299, currency: 'CNY' });
    expect(parseMoney('￥88')).toEqual({ amount: 88, currency: 'CNY' });
    expect(parseMoney('1299 元')).toEqual({ amount: 1299, currency: 'CNY' });
    expect(parseMoney('S$ 15')).toEqual({ amount: 15, currency: 'SGD' });
    expect(parseMoney('HK$99')).toEqual({ amount: 99, currency: 'HKD' });
    expect(parseMoney('SGD 15.90')).toEqual({ amount: 15.9, currency: 'SGD' });
    expect(parseMoney('₺250')).toEqual({ amount: 250, currency: 'TRY' });
    expect(parseMoney('500 日元')).toEqual({ amount: 500, currency: 'JPY' });
    expect(parseMoney('12.5')).toEqual({ amount: 12.5, currency: 'CNY' });
    expect(parseMoney('大概 100')).toBeNull();
    expect(parseMoney('很贵')).toBeNull();
    expect(moneyOf(399)).toEqual({ amount: 399, currency: 'CNY' });
    expect(moneyOf({ amount: 3, currency: 'usd' })).toEqual({ amount: 3, currency: 'USD' });
    expect(moneyOf(null)).toBeNull();
  });

  it('上次用的币种：最近改过的那条；没有就是人民币', () => {
    const it = (at: string, fields: LibraryItem['fields']) => ({ fields, updated_at: at, deleted: false });
    expect(recentCurrency([])).toBe('CNY');
    expect(recentCurrency([it('1', { price: { amount: 1, currency: 'GBP' } }), it('3', { price: { amount: 1, currency: 'SGD' } }), it('2', { price: { amount: 1, currency: 'USD' } })])).toBe('SGD');
  });
});

describe('价格迁移：数字 / 文字 → 金额', () => {
  const item = (id: string, fields: LibraryItem['fields'], note_md = ''): LibraryItem => ({ id, type_id: T.shopping, name: id, image: null, fields, note_md, created_at: '2026-01-01T00:00:00Z', updated_at: '', deleted: false });

  it('数字算人民币，文字按符号认，认不出的记进备注', () => {
    const plan = planFieldMigration([item('a', { price: 1299 }), item('b', { price: '$12.5' }), item('c', { price: '看活动' }), item('d', { price: { amount: 1, currency: 'USD' } })], BUILTIN_TASK_TYPES);
    const by = Object.fromEntries(plan.map((p) => [p.id, p]));
    expect(Object.keys(by).sort()).toEqual(['a', 'b', 'c']);
    expect(by.a!.fields.price).toEqual({ amount: 1299, currency: 'CNY' });
    expect(by.b!.fields.price).toEqual({ amount: 12.5, currency: 'USD' });
    expect(by.c!.fields.price).toBeUndefined();
    expect(by.c!.note_md).toBe('价格：看活动');
  });

  it('打开时：旧的「价格（元）」数字字段升级成金额', async () => {
    const ad = new MemoryAdapter();
    const oldShopping: TaskType = { ...shopping, updated_at: '0000000000000-0001-builtin', fields: shopping.fields.map((f) => (f.key === 'price' ? { key: 'price', label: '价格', kind: 'number' as const, unit: '元' } : f)) };
    await ad.applyChanges([
      { table: 'task_type', row: oldShopping },
      { table: 'library_item', row: item('a', { price: 699 }) },
    ]);
    const s = await Store.open(ad, { deviceId: 'd', now });
    expect(s.get('task_type', T.shopping)!.fields.find((f) => f.key === 'price')!.kind).toBe('money');
    expect(s.get('library_item', 'a')!.fields.price).toEqual({ amount: 699, currency: 'CNY' });
    expect(s.libraryEntries(T.shopping)[0]!.subtitle).toBe('¥699');
  });

  it('演示数据里有不同币种', async () => {
    const s = await Store.open(new MemoryAdapter(), { deviceId: 'd', now });
    seedDemo(s);
    const subs = s.libraryEntries(T.shopping).map((e) => e.subtitle);
    expect(subs).toContain('£59.90');
    expect(subs).toContain('¥1,299');
  });
});
