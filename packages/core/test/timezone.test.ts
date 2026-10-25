import { afterEach, describe, expect, it } from 'vitest';
import {
  allTimeZones,
  commonTimeZones,
  dateKeyInZone,
  formatUtcOffset,
  isTaskOverdue,
  matchTimeZone,
  normalizeTimeZone,
  offsetMinutesOn,
  pushRecentTimeZone,
  taskTimeZone,
  taskToday,
  timeZoneBadge,
  timeZoneLabel,
  todayIn,
} from '../src/timezone';
import { upcomingReminders } from '../src/reminders';
import { suggestions } from '../src/myday';
import { setLocale } from '../src/i18n';
import { mkTask } from './helpers';

const SH = 'Asia/Shanghai';
const NY = 'America/New_York';

afterEach(() => setLocale('zh'));

describe('任务时区（Rei 2026-10-25）', () => {
  it('偏移按那天算：纽约冬天 −5、夏天 −4，上海 +8，印度 +5:30', () => {
    expect(offsetMinutesOn(NY, '2026-01-15')).toBe(-300);
    expect(offsetMinutesOn(NY, '2026-07-15')).toBe(-240);
    expect(offsetMinutesOn(SH, '2026-07-15')).toBe(480);
    expect(formatUtcOffset(-240)).toBe('UTC\u22124');
    expect(formatUtcOffset(330)).toBe('UTC+5:30');
    expect(formatUtcOffset(0)).toBe('UTC');
    // 夏令时切换当天（3-08 凌晨切）：正午已经是 EDT
    expect(offsetMinutesOn(NY, '2026-03-08')).toBe(-240);
    expect(offsetMinutesOn(NY, '2026-11-01')).toBe(-300);
  });

  it('名字：中文城市名 / 英文 IANA 最后一段', () => {
    expect(timeZoneLabel(SH, '2026-10-25')).toBe('上海 (UTC+8)');
    expect(timeZoneLabel(NY, '2026-07-01')).toBe('纽约 (UTC\u22124)');
    expect(timeZoneLabel('America/Argentina/Buenos_Aires', '2026-07-01')).toBe('Buenos Aires (UTC\u22123)');
    setLocale('en');
    expect(timeZoneLabel(NY, '2026-01-01')).toBe('New York (UTC\u22125)');
    expect(timeZoneLabel('UTC', '2026-01-01')).toBe('UTC');
  });

  it('常用列表：设备 → 最近 → 固定，去重；完整列表有 UTC', () => {
    const list = commonTimeZones('Asia/Singapore', ['Europe/Rome', SH, 'Not/AZone']);
    expect(list.slice(0, 3)).toEqual(['Asia/Singapore', 'Europe/Rome', SH]);
    expect(new Set(list).size).toBe(list.length);
    expect(list).not.toContain('Not/AZone');
    expect(list).toContain(NY);
    const all = allTimeZones();
    expect(all[0]).toBe('UTC');
    expect(all).toContain(NY);
    expect(all.length).toBeGreaterThan(100);
    expect(pushRecentTimeZone([SH, NY], NY)).toEqual([NY, SH]);
  });

  it('搜索：城市名、IANA、偏移', () => {
    expect(matchTimeZone(NY, '纽约', '2026-07-01')).toBe(true);
    expect(matchTimeZone(NY, 'new york', '2026-07-01')).toBe(true);
    expect(matchTimeZone(NY, '-4', '2026-07-01')).toBe(true);
    expect(matchTimeZone(NY, '-4', '2026-01-01')).toBe(false);
    expect(matchTimeZone(SH, 'tokyo', '2026-07-01')).toBe(false);
  });

  it('空时区 = 跟着设备（浮动）；乱写的当空', () => {
    expect(normalizeTimeZone(null)).toBeNull();
    expect(normalizeTimeZone('')).toBeNull();
    expect(normalizeTimeZone('Mars/Base')).toBeNull();
    expect(normalizeTimeZone(NY)).toBe(NY);
    expect(taskTimeZone({ time_zone: null }, SH)).toBe(SH);
    expect(taskTimeZone({ time_zone: NY }, SH)).toBe(NY);
    const now = new Date(Date.parse('2026-10-25T01:00:00Z')); // 上海 09:00 10-25，纽约 21:00 10-24
    expect(taskToday({ time_zone: null }, now, '2026-10-25')).toBe('2026-10-25');
    expect(taskToday({ time_zone: NY }, now, '2026-10-25')).toBe('2026-10-24');
    expect(todayIn(NY, now)).toBe('2026-10-24');
    expect(dateKeyInZone(now.getTime(), SH)).toBe('2026-10-25');
  });

  it('过期按任务时区的今天：纽约那天还没过完就不算过期', () => {
    const now = new Date(Date.parse('2026-10-25T01:00:00Z'));
    expect(isTaskOverdue({ time_zone: NY, scheduled_date: '2026-10-24' }, now, '2026-10-25')).toBe(false);
    expect(isTaskOverdue({ time_zone: null, scheduled_date: '2026-10-24' }, now, '2026-10-25')).toBe(true);
  });

  it('时区标注：和设备偏移不同才标', () => {
    expect(timeZoneBadge({ time_zone: null }, '2026-07-01', SH)).toBeNull();
    expect(timeZoneBadge({ time_zone: SH }, '2026-07-01', SH)).toBeNull();
    expect(timeZoneBadge({ time_zone: 'Asia/Singapore' }, '2026-07-01', SH)).toBeNull();
    expect(timeZoneBadge({ time_zone: NY }, '2026-07-01', SH)).toBe('UTC\u22124');
    expect(timeZoneBadge({ time_zone: NY }, '2026-01-01', SH)).toBe('UTC\u22125');
  });

  it('提醒：任务时区的 09:00 换算成绝对时刻（夏令时）', () => {
    const now = new Date(Date.parse('2026-07-10T00:00:00Z'));
    const t = mkTask('ny', { scheduled_date: '2026-07-10', remind_time: '09:00', time_zone: NY });
    const [r] = upcomingReminders([t], [], { now, timeZone: SH });
    expect(new Date(r!.at).toISOString()).toBe('2026-07-10T13:00:00.000Z');
    const w = mkTask('nyw', { scheduled_date: '2026-01-10', remind_time: '09:00', time_zone: NY });
    const [rw] = upcomingReminders([w], [], { now: new Date(Date.parse('2026-01-10T00:00:00Z')), timeZone: SH });
    expect(new Date(rw!.at).toISOString()).toBe('2026-01-10T14:00:00.000Z');
    // 空时区：按传入的（设备）时区
    const f = mkTask('f', { scheduled_date: '2026-07-10', remind_time: '09:00' });
    const [rf] = upcomingReminders([f], [], { now, timeZone: SH });
    expect(new Date(rf!.at).toISOString()).toBe('2026-07-10T01:00:00.000Z');
  });

  it('我的一天建议「今天到期」按任务时区', () => {
    const now = new Date(Date.parse('2026-10-25T01:00:00Z')); // 上海 10-25，纽约还是 10-24
    const ny = mkTask('ny', { scheduled_date: '2026-10-25', time_zone: NY });
    const sh = mkTask('sh', { scheduled_date: '2026-10-25' });
    const s = suggestions({ tasks: [ny, sh], entries: [], checkIns: [], derived: new Map(), recentlyUnlocked: [], today: '2026-10-25', now });
    expect(s.map((x) => x.task.id)).toEqual(['sh']);
  });
});
