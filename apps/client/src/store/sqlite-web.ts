/**
 * Web 端 SQLite（Rei 2026-10-16：所有浏览器统一用官方 sqlite-wasm）。
 * @sqlite.org/sqlite-wasm + opfs-sahpool VFS，跑在专用工作线程（sqlite.worker.ts）里。
 * 单线程，不要 SharedArrayBuffer / 跨源隔离，Chrome 102+、Firefox 111+、Safari 16.4+ 都能用；wasm 约 0.9 MB。
 * 同一时刻只有一个标签页能打开（见 tab-lock.ts）。
 *
 * 以前（2026-10-16 之前）Chrome / Edge 用的是 Turso database-wasm，库文件在 OPFS 根目录的 mindough.db。
 * 第一次用新引擎时把那里的数据整份搬过来（migrateFromTurso），旧文件留作备份。
 * 读旧文件还要 Turso 引擎（多线程、要跨源隔离），所以响应头里的 COOP / COEP 暂时保留。
 */
import { SqlAdapter, migrateStorage, MIGRATED_META_KEY, type SqlDriver, type SqlValue } from '@mindough/core';

import { tr } from '../lib/i18n';

export const WEB_DB_FILE = '/mindough.db';
/** 以前 Turso wasm 的库文件（OPFS 根目录）。 */
export const TURSO_DB_FILE = 'mindough.db';
export const TURSO_MIGRATED_META = 'migrated_from_turso_wasm';

export function webSqliteSupported(): { ok: boolean; reason?: string } {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) return { ok: false, reason: tr('浏览器不支持 OPFS') };
  if (typeof Worker === 'undefined') return { ok: false, reason: tr('浏览器不支持 Web Worker') };
  return { ok: true };
}

class SqliteWasmDriver implements SqlDriver {
  readonly kind = 'sqlite-wasm/opfs-sahpool';
  private seq = 0;
  private waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private dead: Error | null = null;
  constructor(private readonly worker: Worker) {
    worker.onmessage = (ev: MessageEvent) => {
      const { id, ok, rows, error } = ev.data as { id: number; ok: boolean; rows?: unknown[]; error?: string };
      const w = this.waiting.get(id);
      if (!w) return;
      this.waiting.delete(id);
      if (ok) w.resolve(rows);
      else w.reject(new Error(error));
    };
    worker.onerror = (ev) => this.fail(new Error(ev.message || 'sqlite worker error'));
  }
  private fail(e: Error) {
    this.dead = e;
    for (const w of this.waiting.values()) w.reject(e);
    this.waiting.clear();
  }
  call<T>(op: string, extra: Record<string, unknown> = {}): Promise<T> {
    if (this.dead) return Promise.reject(this.dead);
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      this.waiting.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.worker.postMessage({ id, op, ...extra });
    });
  }
  async exec(sql: string) {
    await this.call('exec', { sql });
  }
  async run(sql: string, params: readonly SqlValue[] = []) {
    await this.call('run', { sql, params });
  }
  async all<T>(sql: string, params: readonly SqlValue[] = []) {
    return (await this.call<T[]>('all', { sql, params })) ?? [];
  }
  async close() {
    await this.call('close').catch(() => {});
    this.terminate();
  }
  /** 立刻停掉线程（被别的标签页抢走时用：线程一停，OPFS 句柄就放了）。 */
  terminate() {
    this.worker.terminate();
    this.fail(new Error(tr('本地数据库已交给另一个标签页')));
  }
}

let current: SqliteWasmDriver | null = null;

/** 打开 OPFS 上的数据库；不支持时返回 null。wasm 在工作线程里按需加载，不进首屏包。 */
export async function openWebSqlite(file = WEB_DB_FILE): Promise<SqlDriver | null> {
  if (!webSqliteSupported().ok) return null;
  const worker = new Worker(new URL('./sqlite.worker.ts', import.meta.url), { type: 'module' });
  const driver = new SqliteWasmDriver(worker);
  try {
    await driver.call('open', { file });
  } catch (e) {
    driver.terminate();
    throw e;
  }
  current = driver;
  return driver;
}

/** 被别的标签页「在这里用」抢走时：停掉本页的数据库线程。 */
export function terminateWebSqlite() {
  current?.terminate();
  current = null;
}

/** OPFS 根目录里还有没有以前 Turso wasm 的库文件。 */
async function hasTursoFile(): Promise<boolean> {
  try {
    const root = await navigator.storage.getDirectory();
    const f = await (await root.getFileHandle(TURSO_DB_FILE)).getFile();
    return f.size > 0;
  } catch {
    return false;
  }
}

/**
 * 以前 Turso wasm 里的数据整份搬进新库（只搬一次；行原样复制，LWW 与同步语义不变）。
 * 搬过的新库也记上「已从 localStorage 迁过」，免得再把更旧的 localStorage 备份搬进来。
 * 返回搬了几行；没有旧文件返回 0。读不了旧文件（页面没跨源隔离）就抛错，不悄悄丢数据。
 */
export async function migrateFromTurso(to: SqlAdapter): Promise<number> {
  if (await to.getMeta(TURSO_MIGRATED_META)) return 0;
  if (!(await hasTursoFile())) {
    await to.setMeta(TURSO_MIGRATED_META, 'none');
    return 0;
  }
  if (typeof SharedArrayBuffer === 'undefined' || !globalThis.crossOriginIsolated) {
    throw new Error(tr('以前的本地数据库需要跨源隔离的页面才能读出来'));
  }
  const { connect } = await import('@tursodatabase/database-wasm/vite');
  const old = await connect(TURSO_DB_FILE);
  try {
    const driver: SqlDriver = {
      kind: 'turso-wasm/opfs',
      exec: async (sql) => {
        await old.exec(sql);
      },
      run: async (sql, params = []) => {
        await (await old.prepare(sql)).run(...params);
      },
      all: async <T,>(sql: string, params: readonly SqlValue[] = []) => (await (await old.prepare(sql)).all(...params)) as T[],
    };
    const from = new SqlAdapter(driver);
    const r = await migrateStorage(from, to, TURSO_MIGRATED_META);
    if (!(await to.getMeta(MIGRATED_META_KEY))) await to.setMeta(MIGRATED_META_KEY, new Date().toISOString());
    return r.rows;
  } finally {
    await old.close();
  }
}
