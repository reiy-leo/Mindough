import { describe, expect, it } from 'vitest';
import { groupSubEvents, looksLikeIcs, parseIcs, pickCellEvent, plainSubTitle } from '../src/lunar/ics';
import { DEFAULT_LUNAR_SUB_URL, httpStatusZh, lunarShown, normalizeSubFreq, normalizeSubUrl, subDue, subStatusText, subUrlOf, type SubState } from '../src/lunar/subscription';

// 节选自 Apple「中国大陆节假日」（calendars.icloud.com/holidays/cn_zh.ics）的写法：全天、多天放假、补班、每年重复、折行
const ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'X-WR-CALNAME:中国大陆节假日',
  'BEGIN:VEVENT',
  'DTSTART;VALUE=DATE:20261001',
  'DTEND;VALUE=DATE:20261008',
  'SUMMARY;LANGUAGE=zh_CN:国庆节（休）',
  'X-APPLE-SPECIAL-DAY:WORK-HOLIDAY',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;VALUE=DATE:20261010',
  'SUMMARY;LANGUAGE=zh_CN:国庆节（班）',
  'X-APPLE-SPECIAL-DAY:ALTERNATE-WORKDAY',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;VALUE=DATE:20241001',
  'SUMMARY;LANGUAGE=zh_CN:国庆节',
  'RRULE:FREQ=YEARLY;COUNT=6',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;VALUE=DATE:20261023',
  'SUMMARY;LANGUAGE=zh_CN:霜',
  ' 降',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART:20260925T000000Z',
  'DTEND:20260925T120000Z',
  'SUMMARY:中秋节\\, 团圆',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

describe('ICS 解析', () => {
  const parsed = parseIcs(ICS)!;
  const byDate = groupSubEvents(parsed.events);
  it('日历名、多天、补班、重复、折行、转义', () => {
    expect(parsed.name).toBe('中国大陆节假日');
    expect(byDate.get('2026-10-01')!.map((e) => [e.title, e.kind])).toEqual([
      ['国庆节（休）', 'off'],
      ['国庆节', 'event'],
    ]);
    expect(byDate.get('2026-10-07')![0]!.kind).toBe('off');
    expect(byDate.has('2026-10-08')).toBe(false); // DTEND 不含当天
    expect(byDate.get('2026-10-10')![0]!.kind).toBe('work');
    expect(byDate.get('2029-10-01')![0]!.title).toBe('国庆节');
    expect(byDate.has('2030-10-01')).toBe(false); // COUNT=6
    expect(byDate.get('2026-10-23')![0]!.title).toBe('霜降');
    expect(byDate.get('2026-09-25')![0]!.title).toBe('中秋节, 团圆');
  });
  it('不是日历', () => {
    expect(parseIcs('<html>')).toBeNull();
    expect(looksLikeIcs('\uFEFFBEGIN:VCALENDAR')).toBe(true);
  });
  it('格子显示：节日名 + 休 / 班 角标', () => {
    expect(pickCellEvent(byDate.get('2026-10-01'))).toEqual({ label: '国庆节', badge: 'off', titles: ['国庆节（休）', '国庆节'] });
    expect(pickCellEvent(byDate.get('2026-10-02'))).toEqual({ label: null, badge: 'off', titles: ['国庆节（休）'] });
    expect(pickCellEvent(byDate.get('2026-10-10'))!.badge).toBe('work');
    expect(pickCellEvent(undefined)).toBeNull();
    expect(plainSubTitle('国庆节（休）')).toBe('国庆节');
  });
});

describe('订阅设置', () => {
  it('显示农历默认跟语言', () => {
    expect(lunarShown(undefined, 'zh')).toBe(true);
    expect(lunarShown(undefined, 'en')).toBe(false);
    expect(lunarShown(false, 'zh')).toBe(false);
    expect(lunarShown(true, 'en')).toBe(true);
  });
  it('地址', () => {
    expect(subUrlOf(undefined)).toBe(DEFAULT_LUNAR_SUB_URL);
    expect(subUrlOf('  ')).toBe(DEFAULT_LUNAR_SUB_URL);
    expect(normalizeSubUrl('webcal://example.com/a.ics')).toBe('https://example.com/a.ics');
    expect(normalizeSubUrl('example.com/a.ics')).toBe('https://example.com/a.ics');
    expect(normalizeSubUrl('ftp://x.com/a')).toBeNull();
    expect(normalizeSubUrl('localhost')).toBeNull();
    expect(normalizeSubFreq('weekly')).toBe('weekly');
    expect(normalizeSubFreq('hourly')).toBe('daily');
  });
  it('什么时候自动同步', () => {
    const now = Date.parse('2026-10-17T12:00:00Z');
    const url = DEFAULT_LUNAR_SUB_URL;
    const ok = (h: number): SubState => ({ url, okAt: new Date(now - h * 3600_000).toISOString(), triedAt: new Date(now - h * 3600_000).toISOString(), status: { ok: true, count: 1, name: null } });
    expect(subDue(null, url, 'daily', now)).toBe(true);
    expect(subDue(ok(23), url, 'daily', now)).toBe(false);
    expect(subDue(ok(25), url, 'daily', now)).toBe(true);
    expect(subDue(ok(25), url, 'weekly', now)).toBe(false);
    expect(subDue(ok(24 * 31), url, 'monthly', now)).toBe(true);
    expect(subDue(ok(24 * 400), url, 'manual', now)).toBe(false);
    expect(subDue(ok(1), 'https://other.example/x.ics', 'daily', now)).toBe(true); // 地址换了
    const failed: SubState = { ...ok(30), triedAt: new Date(now - 10 * 60_000).toISOString(), status: { ok: false, code: 404, reason: 'upstream' } };
    expect(subDue(failed, url, 'daily', now)).toBe(false); // 刚失败过，隔一小时
    expect(subDue({ ...failed, triedAt: new Date(now - 2 * 3600_000).toISOString() }, url, 'daily', now)).toBe(true);
  });
  it('状态带中文状态码', () => {
    expect(httpStatusZh(404)).toBe('未找到');
    expect(subStatusText({ ok: false, code: 404, reason: 'upstream' })).toBe('同步失败：订阅源返回 404 未找到');
    expect(subStatusText({ ok: false, code: 504, reason: 'http' })).toBe('同步失败：504 网关超时');
    expect(subStatusText({ ok: true, count: 246, name: null })).toBe('同步成功，246 个日子');
    expect(subStatusText(null)).toBe('还没同步过');
  });
});
