/** 测试用 SQL 驱动：node:sqlite（Node 22 内置）与 Turso（@tursodatabase/database，与 Web 端 wasm 同一引擎）。 */
import { DatabaseSync } from 'node:sqlite';
import { connect } from '@tursodatabase/database';
import type { SqlDriver, SqlValue } from '../src/storage/sql';

export class NodeSqliteDriver implements SqlDriver {
  readonly kind = 'node:sqlite';
  readonly db: DatabaseSync;
  constructor(path = ':memory:') {
    this.db = new DatabaseSync(path);
  }
  async exec(sql: string) {
    this.db.exec(sql);
  }
  async run(sql: string, params: readonly SqlValue[] = []) {
    this.db.prepare(sql).run(...params);
  }
  async all<T>(sql: string, params: readonly SqlValue[] = []) {
    return this.db.prepare(sql).all(...params) as T[];
  }
  async close() {
    this.db.close();
  }
}

type TursoDb = Awaited<ReturnType<typeof connect>>;

export class TursoNodeDriver implements SqlDriver {
  readonly kind = 'turso';
  private constructor(private readonly db: TursoDb) {}
  static async open(path = ':memory:') {
    return new TursoNodeDriver(await connect(path));
  }
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
