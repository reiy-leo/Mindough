import { describe, expect, it } from 'vitest';
import {
  COMPLETION_MODE_HINT,
  COMPLETION_MODE_LABEL,
  COMPLETION_MODES,
  countdownPhrase,
  describeCompletion,
  durationMs,
  durationParts,
  formatTarget,
  friendlyDate,
  quickDates,
} from '../src';

describe('完成方式的叫法', () => {
  it('四种都有名称和一句话说明，内部值不变', () => {
    expect(COMPLETION_MODES).toEqual(['once', 'timer', 'count', 'countdown']);
    expect(COMPLETION_MODE_LABEL).toEqual({ once: '勾选完成', timer: '计时', count: '计数', countdown: '倒数日' });
    for (const m of COMPLETION_MODES) expect(COMPLETION_MODE_HINT[m].length).toBeGreaterThan(3);
  });
});

describe('时长', () => {
  it('毫秒 ↔ 数 + 单位', () => {
    expect(durationParts(10 * 60_000)).toEqual({ value: 10, unit: 'min' });
    expect(durationParts(16 * 3_600_000)).toEqual({ value: 16, unit: 'h' });
    expect(durationParts(90 * 60_000)).toEqual({ value: 1.5, unit: 'h' });
    expect(durationParts(75 * 60_000)).toEqual({ value: 75, unit: 'min' });
    expect(durationParts(null)).toBeNull();
    expect(durationMs(10, 'min')).toBe(600_000);
    expect(durationMs(2, 'h')).toBe(7_200_000);
    expect(durationMs(0, 'min')).toBeNull();
    expect(durationMs(Number.NaN, 'h')).toBeNull();
  });
  it('口语写法', () => {
    expect(formatTarget(10 * 60_000)).toBe('10 分钟');
    expect(formatTarget(16 * 3_600_000)).toBe('16 小时');
    expect(formatTarget(null)).toBe('');
  });
});

describe('倒数日与日期', () => {
  it('还有 / 就是今天 / 已过', () => {
    expect(countdownPhrase('2026-10-20', '2026-10-15')).toBe('还有 5 天');
    expect(countdownPhrase('2026-10-15', '2026-10-15')).toBe('就是今天');
    expect(countdownPhrase('2026-10-10', '2026-10-15')).toBe('已过 5 天');
    expect(countdownPhrase(null, '2026-10-15')).toBe('还没选日期');
  });
  it('相对日期，跨年带年份', () => {
    expect(friendlyDate('2026-10-15', '2026-10-15')).toBe('今天');
    expect(friendlyDate('2026-10-16', '2026-10-15')).toBe('明天');
    expect(friendlyDate('2026-10-20', '2026-10-15')).toBe('10月20日 周二');
    expect(friendlyDate('2027-01-04', '2026-10-15')).toBe('2027年1月4日 周一');
    expect(friendlyDate('2027-01-01', '2026-12-31')).toBe('明天');
  });
  it('快捷日期：周四', () => {
    // 2026-10-15 是周四
    expect(quickDates('2026-10-15')).toEqual([
      { label: '今天', date: '2026-10-15' },
      { label: '明天', date: '2026-10-16' },
      { label: '本周末', date: '2026-10-17' },
      { label: '下周一', date: '2026-10-19' },
    ]);
  });
  it('快捷日期：周六、周日', () => {
    expect(quickDates('2026-10-17').slice(2)).toEqual([
      { label: '下周末', date: '2026-10-24' },
      { label: '下周一', date: '2026-10-19' },
    ]);
    expect(quickDates('2026-10-18').slice(2)).toEqual([
      { label: '下周末', date: '2026-10-24' },
      { label: '下周一', date: '2026-10-19' },
    ]);
  });
});

describe('完成方式摘要', () => {
  const base = { target_value: null, unit: null, target_date: null };
  it('按方式说人话', () => {
    expect(describeCompletion({ ...base, completion_mode: 'once' })).toBe('勾选完成');
    expect(describeCompletion({ ...base, completion_mode: 'timer', target_value: 600_000 })).toBe('计时 · 每次 10 分钟');
    expect(describeCompletion({ ...base, completion_mode: 'timer' })).toBe('计时');
    expect(describeCompletion({ ...base, completion_mode: 'count', target_value: 8, unit: '杯' })).toBe('计数 · 目标 8 杯');
    expect(describeCompletion({ ...base, completion_mode: 'count', target_value: 3 })).toBe('计数 · 目标 3 次');
    expect(describeCompletion({ ...base, completion_mode: 'countdown', target_date: '2026-12-20' }, '2026-10-15')).toBe('倒数日 · 12月20日 周日');
  });
});
