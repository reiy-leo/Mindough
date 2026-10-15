/**
 * Web 端 SQLite：Turso database-wasm，数据库文件放在 OPFS（浏览器私有文件系统）。
 * 选它而不是 @sqlite.org/sqlite-wasm：同步计划用 Turso Sync，Web 端以后可换成同引擎的 sync-wasm。
 *
 * 前提：OPFS + SharedArrayBuffer（wasm 多线程）。后者要求页面跨源隔离（COOP: same-origin +
 * COEP: require-corp），vite dev / preview 与 Worker 静态托管都要带这两个响应头。
 * 不满足时返回 null，由调用方退回 localStorage。
 */
import type { SqlDriver, SqlValue } from '@mindough/core';

export const WEB_DB_FILE = 'mindough.db';

export function webSqliteSupported(): { ok: boolean; reason?: string } {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) return { ok: false, reason: '浏览器不支持 OPFS' };
  if (typeof SharedArrayBuffer === 'undefined' || !globalThis.crossOriginIsolated) return { ok: false, reason: '页面未跨源隔离（缺 COOP / COEP 响应头）' };
  return { ok: true };
}

type TursoDb = Awaited<ReturnType<typeof import('@tursodatabase/database-wasm').connect>>;

class TursoWasmDriver implements SqlDriver {
  readonly kind = 'turso-wasm/opfs';
  constructor(private readonly db: TursoDb) {}
  async exec(sql: string) {
    await this.db.exec(sql);
  }
  async run(sql: string, params: readonly SqlValue[] = []) {
    await (await this.db.prepare(sql)).run(...params);
  }
  async all<T>(sql: string, params: readonly SqlValue[] = []) {
    return (await (await this.db.prepare(sql)).all(...params)) as T[];
  }
  async close() {
    await this.db.close();
  }
}

/** 打开 OPFS 上的数据库；不支持时返回 null。wasm 按需加载，不进首屏包。 */
export async function openWebSqlite(file = WEB_DB_FILE): Promise<SqlDriver | null> {
  if (!webSqliteSupported().ok) return null;
  const { connect } = await import('@tursodatabase/database-wasm/vite');
  const db = await connect(file);
  return new TursoWasmDriver(db);
}
