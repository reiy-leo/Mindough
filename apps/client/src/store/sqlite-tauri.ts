/**
 * Tauri 原生端 SQLite：走 src-tauri/src/db.rs 的命令层（rusqlite，单连接）。
 * schema 与迁移由 core 的 SqlAdapter 负责，与 Web 端同一份。
 */
import type { SqlDriver, SqlValue } from '@mindough/core';

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export async function openTauriSqlite(): Promise<SqlDriver> {
  const { invoke } = await import('@tauri-apps/api/core');
  return {
    kind: 'tauri-rusqlite',
    exec: (sql: string) => invoke<void>('db_exec', { sql }),
    run: (sql: string, params: readonly SqlValue[] = []) => invoke<void>('db_run', { sql, params }),
    all: <T,>(sql: string, params: readonly SqlValue[] = []) => invoke<T[]>('db_all', { sql, params }),
  };
}
