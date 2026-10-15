import { describe, expect, it } from 'vitest';
import { isUuidv7, uuidv7, uuidv7Time } from '../src/uuid';

describe('uuidv7', () => {
  it('格式正确：版本 7、RFC 变体', () => {
    const id = uuidv7();
    expect(isUuidv7(id)).toBe(true);
    expect(id[14]).toBe('7');
    expect('89ab').toContain(id[19]!);
  });

  it('时间戳可取回', () => {
    const t = Date.UTC(2029, 9, 15, 6, 0, 0); // 晚于真实时间，避免受前面用例的单调性影响
    expect(uuidv7Time(uuidv7(t))).toBe(t);
  });

  it('同一毫秒内严格递增，跨毫秒按时间排序', () => {
    const t = Date.UTC(2030, 0, 1);
    const ids = Array.from({ length: 2000 }, () => uuidv7(t));
    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
    expect(new Set(ids).size).toBe(ids.length);
    const later = uuidv7(t + 10_000);
    expect(later > ids.at(-1)!).toBe(true);
  });

  it('时钟回拨也不倒序', () => {
    const a = uuidv7(Date.UTC(2031, 0, 1));
    const b = uuidv7(Date.UTC(2020, 0, 1));
    expect(b > a).toBe(true);
  });
});
