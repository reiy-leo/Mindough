/**
 * 换存储引擎时的一次性迁移（M1：localStorage → SQLite）。
 * 行原样复制（保留 id / updated_at / deleted），所以 LWW 与同步语义不变；
 * 目标库的 outbox 会为每行记一条（同步尚未开通，旧 outbox 里本来也都是待推送）。
 * 源数据不删，留作备份；目标 meta 记下迁移时间，之后不再迁移。
 */
import { TABLES, type BaseRow } from '../types';
import type { Change, StorageAdapter } from './adapter';

export const MIGRATED_META_KEY = 'migrated_from_localstorage';
/** 需要随数据一起带过去的 meta。 */
export const CARRIED_META_KEYS = ['device_id', 'demo_seeded'] as const;

export interface MigrationResult {
  migrated: boolean;
  rows: number;
}

export async function migrateStorage(from: StorageAdapter, to: StorageAdapter, flagKey = MIGRATED_META_KEY): Promise<MigrationResult> {
  if (await to.getMeta(flagKey)) return { migrated: false, rows: 0 };
  const snap = await from.loadAll();
  const changes: Change[] = [];
  for (const t of TABLES) for (const row of snap[t] as BaseRow[]) changes.push({ table: t, row } as Change);
  if (changes.length) {
    // 分批写，避免一个事务过大
    for (let i = 0; i < changes.length; i += 500) await to.applyChanges(changes.slice(i, i + 500));
    for (const k of CARRIED_META_KEYS) {
      const v = await from.getMeta(k);
      if (v !== null && (await to.getMeta(k)) === null) await to.setMeta(k, v);
    }
  }
  await to.setMeta(flagKey, new Date().toISOString());
  return { migrated: changes.length > 0, rows: changes.length };
}
