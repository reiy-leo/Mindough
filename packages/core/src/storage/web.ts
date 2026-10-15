/**
 * Web 适配器（M0）：把整张表序列化进 localStorage（或任何同步 KV）。
 * 以后换成 SQLite WASM（OPFS）/ Turso sync-wasm，接口不变。
 */
import { TABLES, type BaseRow, type TableName } from '../types';
import { MemoryAdapter } from './memory';
import type { Change, Snapshot } from './adapter';

/** localStorage 的最小子集，便于测试时注入。 */
export interface KVStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class WebStorageAdapter extends MemoryAdapter {
  override readonly kind = 'localStorage';
  private loaded = false;

  constructor(
    private readonly kv: KVStorage,
    private readonly prefix = 'mindough:v1:',
  ) {
    super();
  }

  private key(name: string) {
    return this.prefix + name;
  }

  private read<T>(name: string, fallback: T): T {
    const raw = this.kv.getItem(this.key(name));
    if (!raw) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  private ensureLoaded() {
    if (this.loaded) return;
    for (const t of TABLES) {
      const rows = this.read<BaseRow[]>(`table:${t}`, []);
      this.tables.set(t, new Map(rows.map((r) => [r.id, r])));
    }
    this.meta = new Map(Object.entries(this.read<Record<string, string>>('meta', {})));
    this.outbox = this.read('outbox', []);
    this.seq = this.outbox.at(-1)?.seq ?? this.read<number>('seq', 0);
    this.loaded = true;
  }

  private persist(tables: Iterable<TableName>) {
    for (const t of tables) this.kv.setItem(this.key(`table:${t}`), JSON.stringify([...this.tables.get(t)!.values()]));
    this.kv.setItem(this.key('outbox'), JSON.stringify(this.outbox));
    this.kv.setItem(this.key('seq'), JSON.stringify(this.seq));
  }

  override async loadAll(): Promise<Snapshot> {
    this.ensureLoaded();
    return super.loadAll();
  }

  override async applyChanges(changes: readonly Change[]): Promise<void> {
    this.ensureLoaded();
    await super.applyChanges(changes);
    this.persist(new Set(changes.map((c) => c.table)));
  }

  override async applyRemoteChanges(changes: readonly Change[]): Promise<void> {
    this.ensureLoaded();
    await super.applyRemoteChanges(changes);
    this.persist(new Set(changes.map((c) => c.table)));
  }

  override async getMeta(key: string) {
    this.ensureLoaded();
    return super.getMeta(key);
  }

  override async setMeta(key: string, value: string) {
    this.ensureLoaded();
    await super.setMeta(key, value);
    this.kv.setItem(this.key('meta'), JSON.stringify(Object.fromEntries(this.meta)));
  }

  override async ackOutbox(upTo: number) {
    this.ensureLoaded();
    await super.ackOutbox(upTo);
    this.persist([]);
  }

  override async clear() {
    this.ensureLoaded();
    await super.clear();
    this.persist(TABLES);
  }
}
