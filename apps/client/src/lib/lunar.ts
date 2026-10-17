/**
 * 农历（Rei 2026-10-17）：日期格子下的农历小字 + 订阅日历（节气 / 节日 / 法定假日调休）。
 * - 换算本地查表（core lunar/），不联网；订阅经 Worker /api/calendar/ics 代拉（避开 CORS），拉到的存这台设备的 localStorage，离线可用。
 * - 显示农历、订阅地址、同步频率是同步偏好（LUNAR_PREFS）；上次同步时间、状态、数据只在这台设备。
 * - 订阅到的事件只读，不成任务；和本地农历冲突时以订阅的节日名为准（core lunarCellLabel）。
 */
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import {
  LUNAR_PREFS,
  groupSubEvents,
  lunarCellLabel,
  lunarShown,
  normalizeSubFreq,
  parseIcs,
  pickCellEvent,
  subDue,
  subUrlOf,
  type CellSub,
  type DateKey,
  type LunarLabel,
  type Store,
  type SubEvent,
  type SubFreq,
  type SubState,
  type SubStatus,
} from '@mindough/core';
import { API_BASE } from './account';

const STATE_KEY = 'mindough:lunar-sub';
const DATA_KEY = 'mindough:lunar-sub-data';
/** 农历选择模式（这台设备记住上次用的）。 */
export const LUNAR_PICK_KEY = 'mindough:lunar-pick';

type Packed = Array<[string, string, 0 | 1 | 2]>;
const KIND = ['event', 'off', 'work'] as const;

interface Snapshot {
  state: SubState | null;
  byDate: Map<DateKey, SubEvent[]>;
  syncing: boolean;
}

function loadState(): SubState | null {
  try {
    const v = JSON.parse(localStorage.getItem(STATE_KEY) ?? 'null') as SubState | null;
    return v && typeof v.url === 'string' ? v : null;
  } catch {
    return null;
  }
}

function loadData(): Map<DateKey, SubEvent[]> {
  try {
    const packed = JSON.parse(localStorage.getItem(DATA_KEY) ?? '[]') as Packed;
    return groupSubEvents(packed.map(([date, title, k]) => ({ date, title, kind: KIND[k] ?? 'event' })));
  } catch {
    return new Map();
  }
}

let snap: Snapshot = { state: loadState(), byDate: loadData(), syncing: false };
const listeners = new Set<() => void>();
function emit(next: Partial<Snapshot>) {
  snap = { ...snap, ...next };
  for (const f of listeners) f();
}
const subscribe = (f: () => void) => {
  listeners.add(f);
  return () => listeners.delete(f);
};

export function useLunarSub(): Snapshot {
  return useSyncExternalStore(subscribe, () => snap);
}

function saveState(s: SubState) {
  localStorage.setItem(STATE_KEY, JSON.stringify(s));
}

/** 拉一次订阅。fresh = 「立即同步」（Worker 不用缓存）。 */
export async function syncLunarSub(url: string, opts: { fresh?: boolean; fetcher?: typeof fetch } = {}): Promise<SubStatus> {
  const fetcher = opts.fetcher ?? fetch;
  emit({ syncing: true });
  const prev = snap.state?.url === url ? snap.state : null;
  const now = new Date().toISOString();
  let status: SubStatus;
  let events: SubEvent[] | null = null;
  try {
    const res = await fetcher(`${API_BASE}/api/calendar/ics?url=${encodeURIComponent(url)}${opts.fresh ? '&fresh=1' : ''}`, { headers: { accept: 'text/calendar' } });
    if (res.ok) {
      const parsed = parseIcs(await res.text());
      if (!parsed) status = { ok: false, code: null, reason: 'not_ics' };
      else if (!parsed.events.length) status = { ok: false, code: null, reason: 'empty' };
      else {
        events = parsed.events;
        status = { ok: true, count: groupSubEvents(parsed.events).size, name: parsed.name };
      }
    } else {
      const body = (await res.json().catch(() => null)) as { upstream_status?: number } | null;
      if (res.status === 415) status = { ok: false, code: 415, reason: 'not_ics' };
      else if (body?.upstream_status) status = { ok: false, code: body.upstream_status, reason: 'upstream' };
      else status = { ok: false, code: res.status, reason: 'http' };
    }
  } catch {
    status = { ok: false, code: null, reason: 'offline' };
  }
  const state: SubState = { url, okAt: status.ok ? now : (prev?.okAt ?? null), triedAt: now, status };
  saveState(state);
  if (events) {
    const packed: Packed = events.map((e) => [e.date, e.title, KIND.indexOf(e.kind) as 0 | 1 | 2]);
    try {
      localStorage.setItem(DATA_KEY, JSON.stringify(packed));
    } catch {
      /* 存不下就只留在内存里 */
    }
    emit({ state, byDate: groupSubEvents(events), syncing: false });
  } else {
    // 失败：同一个地址的旧数据照常显示；换了地址的旧数据不显示
    const keep = snap.state?.url === url;
    if (!keep) localStorage.removeItem(DATA_KEY);
    emit({ state, syncing: false, ...(keep ? {} : { byDate: new Map() }) });
  }
  return status;
}

export interface LunarPrefs {
  show: boolean;
  url: string;
  freq: SubFreq;
  /** 用户自己填过地址（不是默认源）。 */
  custom: boolean;
}

export function lunarPrefs(store: Store): LunarPrefs {
  const raw = store.pref(LUNAR_PREFS.subUrl);
  return { show: lunarShown(store.pref(LUNAR_PREFS.show)), url: subUrlOf(raw), freq: normalizeSubFreq(store.pref(LUNAR_PREFS.subFreq)), custom: typeof raw === 'string' && !!raw.trim() };
}

/** 到点自动同步：启动、回到前台、每小时看一眼（只在显示农历时）。挂在 App 里一次。 */
export function useLunarSubScheduler(store: Store) {
  const { show, url, freq } = lunarPrefs(store);
  useEffect(() => {
    if (!show) return;
    const check = () => {
      if (snap.syncing || !navigator.onLine) return;
      if (subDue(snap.state, url, freq, Date.now())) void syncLunarSub(url);
    };
    check();
    const timer = window.setInterval(check, 3_600_000);
    const onFocus = () => check();
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onFocus);
    };
  }, [show, url, freq]);
}

export interface DayLunar {
  /** 格子 / 标题里的小字（订阅的节日名优先）。 */
  label: LunarLabel | null;
  /** 订阅日历这天的情况（放假 / 补班角标、全部事件名）。 */
  sub: CellSub | null;
}

/** 拿某天的农历和订阅事件；没开「显示农历」时 show = false（调用方不显示）。 */
export function useLunar(store: Store): { show: boolean; day: (d: DateKey) => DayLunar } {
  const { show, url } = lunarPrefs(store);
  const { byDate, state } = useLunarSub();
  return useMemo(() => {
    const ours = state?.url === url ? byDate : new Map<DateKey, SubEvent[]>();
    return {
      show,
      day: (d: DateKey) => {
        const sub = pickCellEvent(ours.get(d));
        return { label: lunarCellLabel(d, sub?.label ?? null), sub };
      },
    };
  }, [show, url, byDate, state?.url]);
}
