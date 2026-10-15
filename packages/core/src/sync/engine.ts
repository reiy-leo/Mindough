/**
 * 同步引擎（各端共用，纯 TS）：本机 SQLite / localStorage 照常读写，引擎在后台把 outbox 推上云端、按游标拉增量。
 * UI 永不等它：写入先落本地，推送是防抖后的后台任务；拉下来的行经 Store.applyRemote 合并。
 *
 * 合并规则（与云端一致）：
 * - 行级 LWW：updated_at（HLC = 毫秒-计数-设备 id）大者胜；同毫秒同计数时按设备 id 定先后，各端结果一样。
 * - 删除是墓碑（deleted = true）的一次写入，同样按 LWW 比较。
 * - check_in 只追加（每次打卡一行新 id），天然不冲突，进度由全部打卡折叠得出。
 * - 合并后前后关系若绕成环，Store.conflictEdges() 给出“后到的那条”，界面提示去掉其一。
 *
 * 第一次在这台设备上登录（bootstrap）：
 * 1. 先把云端全部拉下来；
 * 2. 云端已有数据、而这台设备只有没动过的演示数据时，把演示数据打墓碑（不然每台新设备都会带一份演示数据上去）；
 * 3. 合并云端行（LWW），再把本机比云端新的行推上去——本机数据不会丢；
 * 4. 记下游标与“已初始化”，以后只做增量。
 */
import { parseHlc } from '../hlc';
import { TABLES, type BaseRow, type TableName } from '../types';
import type { Change } from '../storage/adapter';
import type { Store } from '../store';
import { PULL_PAGE, PUSH_BATCH, SyncHttpError, type PulledRow, type SyncTransport, type WireRow } from './protocol';

export type SyncPhase = 'idle' | 'syncing' | 'offline' | 'error';

export interface SyncStatus {
  phase: SyncPhase;
  /** 最后一次成功同步的时间（ISO）。 */
  lastSyncedAt: string | null;
  /** phase = error 时给人看的说明（已按 COPY.md 写好）。 */
  error: string | null;
  /** 需要重新登录（凭据被拒）。 */
  needsLogin: boolean;
}

type Timer = unknown;
interface Timers {
  set(fn: () => void, ms: number): Timer;
  clear(t: Timer): void;
}
const g = globalThis as unknown as { setTimeout(fn: () => void, ms: number): Timer; clearTimeout(t: Timer): void };
const defaultTimers: Timers = { set: (fn, ms) => g.setTimeout(fn, ms), clear: (t) => g.clearTimeout(t) };

export interface SyncEngineOptions {
  /** 账户（邮箱）；游标等 meta 按账户分开记。 */
  account: string;
  /** 本机写入后多久推送（毫秒）。默认 1500。 */
  debounceMs?: number;
  timers?: Timers;
  now?: () => Date;
  onError?: (err: unknown) => void;
}

/** 内置类型 / 内置打卡分类：时间戳为 0 的固定行，每台设备都有，不算“数据”。 */
export const isSeedRow = (r: Pick<BaseRow, 'updated_at'>) => /^0{13}-/.test(r.updated_at);

const metaKey = (account: string, k: string) => `sync:${account.toLowerCase()}:${k}`;
/** 演示数据写完时记下的最大 updated_at（apps/client 的 openWebStore 写）。 */
export const DEMO_STAMP_META = 'demo_stamp';

export function toWire(table: TableName, row: BaseRow): WireRow {
  return { table, id: row.id, updated_at: row.updated_at, deleted: !!row.deleted, row };
}

export function fromWire(w: WireRow): Change {
  return { table: w.table, row: { ...w.row, id: w.id, updated_at: w.updated_at, deleted: !!w.deleted } } as Change;
}

/** 把错误说成人话（COPY.md：HTTP 状态码附中文说明）。 */
export function describeSyncError(e: unknown): { offline: boolean; needsLogin: boolean; text: string } {
  if (e instanceof SyncHttpError) {
    if (e.offline) return { offline: true, needsLogin: false, text: '离线，联网后自动同步' };
    if (e.status === 401) return { offline: false, needsLogin: true, text: '登录已过期（401 未登录），重新登录后继续同步' };
    if (e.status === 403) return { offline: false, needsLogin: true, text: '这个账户不能同步（403 无权限）' };
    return { offline: false, needsLogin: false, text: e.message };
  }
  return { offline: false, needsLogin: false, text: `同步出错：${e instanceof Error ? e.message : String(e)}` };
}

export class SyncEngine {
  private status: SyncStatus = { phase: 'idle', lastSyncedAt: null, error: null, needsLogin: false };
  private listeners = new Set<() => void>();
  private running: Promise<void> | null = null;
  private again = false;
  private timer: Timer | null = null;
  private unsub: (() => void) | null = null;
  private stopped = false;
  private readonly timers: Timers;
  private readonly debounceMs: number;
  private readonly now: () => Date;

  constructor(
    readonly store: Store,
    private readonly transport: SyncTransport,
    private readonly opts: SyncEngineOptions,
  ) {
    this.timers = opts.timers ?? defaultTimers;
    this.debounceMs = opts.debounceMs ?? 1500;
    this.now = opts.now ?? (() => new Date());
  }

  private key(k: string) {
    return metaKey(this.opts.account, k);
  }

  get snapshot(): SyncStatus {
    return this.status;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(patch: Partial<SyncStatus>) {
    this.status = { ...this.status, ...patch };
    for (const fn of this.listeners) fn();
  }

  /** 开始：读上次同步时间，订阅本机写入（防抖推送），并立即同步一次。 */
  async start(): Promise<void> {
    this.stopped = false;
    const last = await this.store.adapter.getMeta(this.key('last_synced_at'));
    if (last) this.set({ lastSyncedAt: last });
    this.unsub?.();
    this.unsub = this.store.onLocalWrite(() => this.schedule());
    void this.syncNow();
  }

  /** 停止（退出登录）：不再推拉；本机数据原样保留。 */
  async stop(): Promise<void> {
    this.stopped = true;
    this.unsub?.();
    this.unsub = null;
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = null;
    await this.running?.catch(() => {});
  }

  /** 本机写入后防抖推送。 */
  schedule(ms = this.debounceMs): void {
    if (this.stopped) return;
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = this.timers.set(() => {
      this.timer = null;
      void this.syncNow();
    }, ms);
  }

  /** 立即同步（推 + 拉）。正在同步时排一次，跑完再来一轮。永不抛错，结果在 status 里。 */
  syncNow(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.again = false;
        this.set({ phase: 'syncing' });
        try {
          await this.runOnce();
          const at = this.now().toISOString();
          await this.store.adapter.setMeta(this.key('last_synced_at'), at);
          this.set({ phase: 'idle', lastSyncedAt: at, error: null, needsLogin: false });
        } catch (e) {
          const d = describeSyncError(e);
          this.set({ phase: d.offline ? 'offline' : 'error', error: d.offline ? null : d.text, needsLogin: d.needsLogin });
          if (!d.offline) this.opts.onError?.(e);
          this.again = false;
        }
      } while (this.again && !this.stopped);
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async runOnce(): Promise<void> {
    await this.store.flush();
    if (!(await this.store.adapter.getMeta(this.key('bootstrapped')))) await this.bootstrap();
    else await this.pushPending();
    await this.pullFrom(Number((await this.store.adapter.getMeta(this.key('cursor'))) ?? 0));
    await this.store.flush();
  }

  /** 这台设备是否只有没动过的演示数据（或什么都没有）。 */
  async isPristineDemo(): Promise<boolean> {
    const adapter = this.store.adapter;
    if (!(await adapter.getMeta('demo_seeded'))) return false;
    const rows: BaseRow[] = [];
    for (const t of TABLES) for (const r of this.store.listAll(t) as BaseRow[]) if (!isSeedRow(r)) rows.push(r);
    if (!rows.length) return true;
    const stamp = await adapter.getMeta(DEMO_STAMP_META);
    if (stamp) return rows.every((r) => r.updated_at <= stamp);
    // M2 之前播的演示数据没记 demo_stamp：演示数据是一批写进去的，全部在 10 秒内；之后有过任何改动就不算
    const ms = rows.map((r) => parseHlc(r.updated_at).ms).filter((x) => Number.isFinite(x));
    return ms.length === rows.length && Math.max(...ms) - Math.min(...ms) <= 10_000;
  }

  private async bootstrap(): Promise<void> {
    const adapter = this.store.adapter;
    // 1. 云端全部
    const remote: PulledRow[] = [];
    let cursor = 0;
    for (;;) {
      const page = await this.transport.pull(cursor, PULL_PAGE);
      remote.push(...page.rows);
      cursor = page.cursor;
      if (!page.more) break;
    }
    const remoteAt = new Map(remote.map((r) => [`${r.table}/${r.id}`, r.updated_at]));
    const remoteHasData = remote.some((r) => !isSeedRow(r));

    // 2. 云端已有数据 + 本机只有演示数据 → 演示数据不带上去
    if (remoteHasData && (await this.isPristineDemo())) {
      const drop: Array<{ table: TableName; row: BaseRow }> = [];
      for (const t of TABLES)
        for (const r of this.store.list(t) as BaseRow[]) if (!isSeedRow(r) && !remoteAt.has(`${t}/${r.id}`)) drop.push({ table: t, row: { ...r, deleted: true } });
      this.store.write(drop);
      await this.store.flush();
    }

    // 3. 合并云端，再推本机更新的
    const outboxBefore = await adapter.pendingOutbox(Number.MAX_SAFE_INTEGER);
    this.store.applyRemote(remote.map(fromWire));
    const up: WireRow[] = [];
    for (const t of TABLES)
      for (const r of this.store.listAll(t) as BaseRow[]) {
        const at = remoteAt.get(`${t}/${r.id}`);
        if (at === undefined || r.updated_at > at) up.push(toWire(t, r));
      }
    for (let i = 0; i < up.length; i += PUSH_BATCH) await this.transport.push(up.slice(i, i + PUSH_BATCH));
    const maxSeq = outboxBefore.at(-1)?.seq;
    if (maxSeq !== undefined) await adapter.ackOutbox(maxSeq);

    // 4. 记下游标（自己刚推的会在下次拉取时回来，LWW 下是空操作）
    await adapter.setMeta(this.key('cursor'), String(cursor));
    await adapter.setMeta(this.key('bootstrapped'), this.now().toISOString());
    await this.store.flush();
  }

  /** 推 outbox：同一行多次改动只推当前值；推成功才确认（ack）。 */
  private async pushPending(): Promise<void> {
    const adapter = this.store.adapter;
    for (;;) {
      const entries = await adapter.pendingOutbox(1000);
      if (!entries.length) return;
      const seen = new Set<string>();
      const rows: WireRow[] = [];
      for (const e of entries) {
        const k = `${e.table}/${e.id}`;
        if (seen.has(k)) continue;
        seen.add(k);
        const row = this.store.raw(e.table, e.id) as BaseRow | undefined;
        if (row) rows.push(toWire(e.table, row));
      }
      for (let i = 0; i < rows.length; i += PUSH_BATCH) await this.transport.push(rows.slice(i, i + PUSH_BATCH));
      await adapter.ackOutbox(entries.at(-1)!.seq);
      if (entries.length < 1000) return;
    }
  }

  private async pullFrom(cursor: number): Promise<void> {
    for (;;) {
      const page = await this.transport.pull(cursor, PULL_PAGE);
      if (page.rows.length) this.store.applyRemote(page.rows.map(fromWire));
      if (page.cursor !== cursor) {
        cursor = page.cursor;
        await this.store.adapter.setMeta(this.key('cursor'), String(cursor));
      }
      if (!page.more) return;
    }
  }
}
