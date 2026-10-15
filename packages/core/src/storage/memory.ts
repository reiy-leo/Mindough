/** 内存适配器：测试与无持久化场景用。 */
import { TABLES, type BaseRow, type TableName } from '../types';
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
import { emptySnapshot, lwwPick, type Change, type OutboxEntry, type Snapshot, type StorageAdapter } from './adapter';

export class MemoryAdapter implements StorageAdapter {
  readonly kind: string = 'memory';
  protected tables = new Map<TableName, Map<string, BaseRow>>(TABLES.map((t) => [t, new Map()]));
  protected meta = new Map<string, string>();
  protected outbox: OutboxEntry[] = [];
  protected seq = 0;

  async loadAll(): Promise<Snapshot> {
    const snap = emptySnapshot();
    for (const t of TABLES) (snap[t] as BaseRow[]) = [...this.tables.get(t)!.values()].map((r) => clone(r));
    return snap;
  }

  async applyChanges(changes: readonly Change[]): Promise<void> {
    for (const c of changes) {
      const table = this.tables.get(c.table)!;
      const winner = lwwPick(table.get(c.row.id), c.row as BaseRow);
      table.set(c.row.id, clone(winner));
      this.outbox.push({ seq: ++this.seq, table: c.table, id: c.row.id, updated_at: c.row.updated_at });
    }
  }

  async getMeta(key: string): Promise<string | null> {
    return this.meta.get(key) ?? null;
  }

  async setMeta(key: string, value: string): Promise<void> {
    this.meta.set(key, value);
  }

  async pendingOutbox(limit = 500): Promise<OutboxEntry[]> {
    return this.outbox.slice(0, limit);
  }

  async ackOutbox(upTo: number): Promise<void> {
    this.outbox = this.outbox.filter((e) => e.seq > upTo);
  }

  async clear(): Promise<void> {
    for (const t of TABLES) this.tables.get(t)!.clear();
    this.outbox = [];
  }
}
