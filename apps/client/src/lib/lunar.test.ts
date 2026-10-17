import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_LUNAR_SUB_URL } from '@mindough/core';
import { syncLunarSub } from './lunar';

function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}
beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()));
afterEach(() => vi.unstubAllGlobals());

const ICS = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20261001\r\nDTEND;VALUE=DATE:20261003\r\nSUMMARY:国庆节（休）\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
const f = (res: () => Response) => vi.fn(async () => res()) as unknown as typeof fetch;

describe('农历订阅同步', () => {
  it('经 Worker 代拉、存进本机、状态记成功', async () => {
    const fetcher = vi.fn(async (_u: string) => new Response(ICS, { status: 200 }));
    const s = await syncLunarSub(DEFAULT_LUNAR_SUB_URL, { fresh: true, fetcher: fetcher as unknown as typeof fetch });
    expect(s).toEqual({ ok: true, count: 2, name: null });
    expect(String(fetcher.mock.calls[0]![0])).toBe(`/api/calendar/ics?url=${encodeURIComponent(DEFAULT_LUNAR_SUB_URL)}&fresh=1`);
    expect(JSON.parse(localStorage.getItem('mindough:lunar-sub-data')!)).toEqual([
      ['2026-10-01', '国庆节（休）', 1],
      ['2026-10-02', '国庆节（休）', 1],
    ]);
    expect(JSON.parse(localStorage.getItem('mindough:lunar-sub')!).okAt).toBeTruthy();
  });

  it('源 404：记下 upstream 状态码，同一地址的旧数据保留', async () => {
    await syncLunarSub(DEFAULT_LUNAR_SUB_URL, { fetcher: f(() => new Response(ICS)) });
    const s = await syncLunarSub(DEFAULT_LUNAR_SUB_URL, { fetcher: f(() => new Response(JSON.stringify({ error: '502', upstream_status: 404 }), { status: 502 })) });
    expect(s).toEqual({ ok: false, code: 404, reason: 'upstream' });
    expect(localStorage.getItem('mindough:lunar-sub-data')).not.toBeNull();
    expect(JSON.parse(localStorage.getItem('mindough:lunar-sub')!).okAt).toBeTruthy();
  });

  it('不是日历 / 断网', async () => {
    expect(await syncLunarSub('https://x.example/a', { fetcher: f(() => new Response('{"error":"415"}', { status: 415 })) })).toEqual({ ok: false, code: 415, reason: 'not_ics' });
    expect(await syncLunarSub('https://x.example/a', { fetcher: vi.fn(async () => { throw new TypeError('offline'); }) as unknown as typeof fetch })).toEqual({ ok: false, code: null, reason: 'offline' });
  });
});
