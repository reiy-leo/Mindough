/**
 * SQLite 存储适配器：实现 StorageAdapter，底下换驱动即可跑在各端：
 * - Web：Turso database-wasm（OPFS 持久化），见 apps/client/src/store/sqlite-web.ts
 * - Tauri 原生：tauri-plugin-sql（sqlite），见 apps/client/src/store/sqlite-tauri.ts
 * - 测试：node:sqlite（Node 22），见 test/sql-driver.ts
 *
 * 写入：一批变更在一个事务里 upsert（行级 LWW：updated_at 大者胜，相等保留已有），并逐条进 outbox。
 * 所有操作经内部队列串行执行，避免并发事务交叉。
 */
import { TABLES, type BaseRow, type TableName } from '../types';
import { emptySnapshot, type Change, type OutboxEntry, type Snapshot, type StorageAdapter } from './adapter';
import { COLUMNS, MIGRATIONS, q, type ColType, type Migration } from './schema';

export type SqlValue = string | number | null;

/** 最小异步 SQL 驱动。各端实现它即可。 */
export interface SqlDriver {
  readonly kind: string;
  /** 执行多条语句（迁移用），无参数。 */
  exec(sql: string): Promise<void>;
  run(sql: string, params?: readonly SqlValue[]): Promise<void>;
  all<T = Record<string, unknown>>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
  close?(): Promise<void>;
}

function encode(type: ColType, v: unknown): SqlValue {
  if (v === undefined || v === null) return type === 'json' ? '{}' : type === 'bool' ? 0 : null;
  switch (type) {
    case 'json':
      return JSON.stringify(v);
    case 'bool':
      return v ? 1 : 0;
    case 'int':
    case 'int?':
    case 'real':
    case 'real?':
      return typeof v === 'number' ? v : Number(v);
    default:
      return String(v);
  }
}

function decode(type: ColType, v: unknown): unknown {
  if (v === null || v === undefined) return type === 'json' ? {} : type === 'bool' ? false : null;
  switch (type) {
    case 'json':
      try {
        return JSON.parse(String(v));
      } catch {
        return {};
      }
    case 'bool':
      return Number(v) !== 0;
    case 'int':
    case 'int?':
    case 'real':
    case 'real?':
      return typeof v === 'bigint' ? Number(v) : Number(v);
    default:
      return String(v);
  }
}

const colsOf = (t: TableName) => Object.entries(COLUMNS[t]) as Array<[string, ColType]>;

/** 预先拼好每张表的 upsert 语句。 */
const UPSERT: Record<TableName, string> = Object.fromEntries(
  TABLES.map((t) => {
    const names = ['id', 'updated_at', 'deleted', ...colsOf(t).map(([c]) => c)];
    const set = names
      .filter((c) => c !== 'id')
      .map((c) => `${q(c)} = excluded.${q(c)}`)
      .join(', ');
    return [
      t,
      `INSERT INTO ${q(t)} (${names.map(q).join(', ')}) VALUES (${names.map(() => '?').join(', ')}) ` +
        `ON CONFLICT(${q('id')}) DO UPDATE SET ${set} WHERE excluded.${q('updated_at')} > ${q(t)}.${q('updated_at')}`,
    ];
  }),
) as Record<TableName, string>;

export function rowToParams(table: TableName, row: BaseRow): SqlValue[] {
  const r = row as unknown as Record<string, unknown>;
  return [row.id, row.updated_at, row.deleted ? 1 : 0, ...colsOf(table).map(([c, type]) => encode(type, r[c]))];
}

export function rowFromSql(table: TableName, rec: Record<string, unknown>): BaseRow {
  const out: Record<string, unknown> = { id: String(rec.id), updated_at: String(rec.updated_at), deleted: Number(rec.deleted) !== 0 };
  for (const [c, type] of colsOf(table)) out[c] = decode(type, rec[c]);
  return out as unknown as BaseRow;
}

/** 应用未执行的迁移，返回迁移后的版本。 */
export async function migrate(db: SqlDriver, migrations: readonly Migration[] = MIGRATIONS): Promise<number> {
  await db.exec(`CREATE TABLE IF NOT EXISTS "schema_version" ("version" INTEGER PRIMARY KEY NOT NULL, "name" TEXT NOT NULL, "applied_at" TEXT NOT NULL)`);
  const rows = await db.all<{ v: number | null }>(`SELECT MAX("version") AS v FROM "schema_version"`);
  let current = Number(rows[0]?.v ?? 0);
  for (const m of migrations) {
    if (m.version <= current) continue;
    await db.exec('BEGIN IMMEDIATE');
    try {
      // 拿到写锁后再看一次：别的窗口可能刚跑完这一步
      const again = await db.all<{ v: number | null }>(`SELECT MAX("version") AS v FROM "schema_version"`);
      if (Number(again[0]?.v ?? 0) >= m.version) {
        await db.exec('COMMIT');
        current = Number(again[0]?.v ?? 0);
        continue;
      }
      await db.exec(m.sql);
      await db.run(`INSERT INTO "schema_version" ("version", "name", "applied_at") VALUES (?, ?, ?)`, [m.version, m.name, new Date().toISOString()]);
      await db.exec('COMMIT');
    } catch (e) {
      await db.exec('ROLLBACK').catch(() => {});
      throw e;
    }
    current = m.version;
  }
  return current;
}

export class SqlAdapter implements StorageAdapter {
  readonly kind: string;
  private queue: Promise<unknown> = Promise.resolve();
  private ready: Promise<number>;

  constructor(
    readonly db: SqlDriver,
    kind?: string,
  ) {
    this.kind = kind ?? `sqlite:${db.kind}`;
    this.ready = migrate(db);
  }

  /** 迁移后的 schema 版本。 */
  schemaVersion(): Promise<number> {
    return this.ready;
  }

  /** 串行执行（迁移完成后）。 */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(() => this.ready).then(fn);
    this.queue = next.catch(() => {});
    return next;
  }

  private async tx(fn: () => Promise<void>) {
    await this.db.exec('BEGIN');
    try {
      await fn();
      await this.db.exec('COMMIT');
    } catch (e) {
      await this.db.exec('ROLLBACK').catch(() => {});
      throw e;
    }
  }

  loadAll(): Promise<Snapshot> {
    return this.serial(async () => {
      const snap = emptySnapshot();
      for (const t of TABLES) {
        const rows = await this.db.all(`SELECT * FROM ${q(t)}`);
        (snap[t] as BaseRow[]) = rows.map((r) => rowFromSql(t, r));
      }
      return snap;
    });
  }

  applyChanges(changes: readonly Change[]): Promise<void> {
    if (!changes.length) return this.serial(async () => {});
    return this.serial(() =>
      this.tx(async () => {
        for (const c of changes) {
          await this.db.run(UPSERT[c.table], rowToParams(c.table, c.row as BaseRow));
          await this.db.run(`INSERT INTO "outbox" ("tbl", "row_id", "updated_at") VALUES (?, ?, ?)`, [c.table, c.row.id, c.row.updated_at]);
        }
      }),
    );
  }

  applyRemoteChanges(changes: readonly Change[]): Promise<void> {
    const known = changes.filter((c) => (TABLES as readonly string[]).includes(c.table));
    if (!known.length) return this.serial(async () => {});
    return this.serial(() =>
      this.tx(async () => {
        for (const c of known) await this.db.run(UPSERT[c.table], rowToParams(c.table, c.row as BaseRow));
      }),
    );
  }

  getMeta(key: string): Promise<string | null> {
    return this.serial(async () => {
      const rows = await this.db.all<{ value: string }>(`SELECT "value" FROM "meta" WHERE "key" = ?`, [key]);
      return rows[0] ? String(rows[0].value) : null;
    });
  }

  setMeta(key: string, value: string): Promise<void> {
    return this.serial(() =>
      this.db.run(`INSERT INTO "meta" ("key", "value") VALUES (?, ?) ON CONFLICT("key") DO UPDATE SET "value" = excluded."value"`, [key, value]),
    );
  }

  pendingOutbox(limit = 500): Promise<OutboxEntry[]> {
    return this.serial(async () => {
      const rows = await this.db.all<{ seq: number; tbl: string; row_id: string; updated_at: string }>(
        `SELECT "seq", "tbl", "row_id", "updated_at" FROM "outbox" ORDER BY "seq" LIMIT ?`,
        [limit],
      );
      return rows.map((r) => ({ seq: Number(r.seq), table: r.tbl as TableName, id: String(r.row_id), updated_at: String(r.updated_at) }));
    });
  }

  ackOutbox(upTo: number): Promise<void> {
    return this.serial(() => this.db.run(`DELETE FROM "outbox" WHERE "seq" <= ?`, [upTo]));
  }

  /** 清空数据与 outbox，保留 meta（device_id 等）。 */
  clear(): Promise<void> {
    return this.serial(() =>
      this.tx(async () => {
        for (const t of TABLES) await this.db.run(`DELETE FROM ${q(t)}`);
        await this.db.run(`DELETE FROM "outbox"`);
      }),
    );
  }
}
