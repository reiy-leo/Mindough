/**
 * Tauri 原生端 SQLite：走 src-tauri/src/db.rs 的命令层（rusqlite，单连接）。
 * schema 与迁移由 core 的 SqlAdapter 负责，与 Web 端同一份。
 */
import type { SqlDriver, SqlValue } from '@mindough/core';

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * 原生端只有一条连接，一个窗口里也只能有一个 SqlAdapter 在发 BEGIN / COMMIT。
 * 开发模式下 React StrictMode 会把打开数据库的 effect 跑两遍，两份迁移同时 BEGIN 就报
 * 「cannot start a transaction within a transaction」（Rei 2026-10-26 在 pnpm tauri dev 里遇到）。
 * 所以同一个窗口只建一次驱动，后来的调用拿同一个。
 */
let shared: Promise<SqlDriver> | null = null;

export function openTauriSqlite(): Promise<SqlDriver> {
  shared ??= (async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    return {
      kind: 'tauri-rusqlite',
      exec: (sql: string) => invoke<void>('db_exec', { sql }),
      run: (sql: string, params: readonly SqlValue[] = []) => invoke<void>('db_run', { sql, params }),
      all: <T,>(sql: string, params: readonly SqlValue[] = []) => invoke<T[]>('db_all', { sql, params }),
    };
  })();
  return shared;
}
