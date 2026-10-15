/**
 * 存储适配器接口。SQLite（tauri-plugin-sql）/ Turso Sync / SQLite WASM 适配器以后实现同一接口。
 * 设计为异步：原生与 WASM 驱动都是异步的；UI 读的是 Store 里的内存快照，永不等待存储或网络。
 *
 * 同步友好：
 * - 每行带 UUIDv7 id、HLC updated_at、deleted 墓碑，只做 upsert，不物理删除；
 * - applyChanges 同时写入 outbox，同步引擎以后从 outbox 批量 push，再按游标 pull；
 * - meta 存 device_id、同步游标等。
 */
import type { BaseRow, Hlc, TableMap, TableName } from '../types';

export type Snapshot = { [K in TableName]: TableMap[K][] };

export interface Change<K extends TableName = TableName> {
  table: K;
  row: TableMap[K];
}

export interface OutboxEntry {
  /** 自增序号（适配器内单调）。 */
  seq: number;
  table: TableName;
  id: string;
  updated_at: Hlc;
}

export interface StorageAdapter {
  readonly kind: string;
  loadAll(): Promise<Snapshot>;
  /** 原子地写入一批行（upsert），并追加到 outbox。 */
  applyChanges(changes: readonly Change[]): Promise<void>;
  getMeta(key: string): Promise<string | null>;
  setMeta(key: string, value: string): Promise<void>;
  /** 待推送的变更（按 seq 升序）。 */
  pendingOutbox(limit?: number): Promise<OutboxEntry[]>;
  /** 推送成功后确认，删除 seq ≤ upTo 的条目。 */
  ackOutbox(upTo: number): Promise<void>;
  /** 清空所有数据（设置里“重置演示数据”用）。 */
  clear(): Promise<void>;
}

export function emptySnapshot(): Snapshot {
  return {
    task: [],
    dependency: [],
    group: [],
    category: [],
    task_type: [],
    person: [],
    task_person: [],
    my_day: [],
    check_in: [],
    asset: [],
  };
}

/** 行级 LWW：updated_at 大者胜；相等时保留已有（幂等）。 */
export function lwwPick<T extends BaseRow>(existing: T | undefined, incoming: T): T {
  if (!existing) return incoming;
  return incoming.updated_at > existing.updated_at ? incoming : existing;
}
