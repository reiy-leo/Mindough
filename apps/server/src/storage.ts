/**
 * 云端存储选哪个：Worker 环境变量 STORAGE_BACKEND（Rei 2026-10-17：「这个切换数据库用环境变量切换」）。
 * - 没设 / turso → Turso Cloud 库 mindough（东京，默认；Rei 2026-10-16 定过云端先继续用 Turso）
 * - d1 → Cloudflare D1 库 mindough（绑定 DB）
 * - 别的值 → 503（配置写错了，不悄悄回退到某一个库，免得两边数据分叉）
 * 切换前先用 scripts/copy-storage.ts 把数据全量复制过去并核对（见 docs/PLAN.md「云端存储：Turso / D1」）。
 */
import { d1Db, type D1Like } from './d1';
import { DbError, type SqlDb, type StorageBackend } from './sql';
import { tursoDb, type TursoEnv } from './turso';

export interface StorageEnv extends TursoEnv {
  /** turso（默认）| d1 */
  STORAGE_BACKEND?: string;
  /** D1 绑定（wrangler 配置 d1_databases，库名 mindough） */
  DB?: D1Like;
}

/** 环境变量 → 后端；写错了返回 null。 */
export function storageBackend(env: StorageEnv): StorageBackend | null {
  const v = (env.STORAGE_BACKEND ?? '').trim().toLowerCase();
  if (v === '' || v === 'turso') return 'turso';
  if (v === 'd1') return 'd1';
  return null;
}

export const badBackendError = (env: StorageEnv) =>
  new DbError(`503 服务不可用：STORAGE_BACKEND 只能是 turso 或 d1（现在是「${env.STORAGE_BACKEND}」）`, 503);

export function openDb(env: StorageEnv, fetcher: typeof fetch = fetch): SqlDb {
  const backend = storageBackend(env);
  if (backend === 'd1') return d1Db(env.DB);
  if (backend === 'turso') return tursoDb(env, fetcher);
  const err = badBackendError(env);
  const fail = async (): Promise<never> => {
    throw err;
  };
  return { backend: 'turso', configured: false, execute: fail, transaction: fail };
}
