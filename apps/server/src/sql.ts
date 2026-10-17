/**
 * 云端存储层的公共形状：Worker 只需要“执行几条 SQL”与“在一个事务里执行几条 SQL”。
 * Turso（turso.ts，Hrana HTTP）与 Cloudflare D1（d1.ts，Worker 绑定 / REST API）各实现一份，
 * 选哪个由环境变量 STORAGE_BACKEND 决定（storage.ts）。两边是同一份 SQLite 方言、同一套 SERVER_MIGRATIONS。
 */
export type Value = string | number | null;
export interface Stmt {
  sql: string;
  args?: readonly Value[];
}
export type Row = Record<string, Value>;

export type StorageBackend = 'turso' | 'd1';

/** 存储层出错：message 以状态码开头（如「502 网关错误：…」），status 是返回给客户端的状态码。 */
export class DbError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message);
    this.name = 'DbError';
  }
}

export interface SqlDb {
  readonly backend: StorageBackend;
  /** 凭据 / 绑定配好了没有；没配好时 execute / transaction 抛 503。 */
  readonly configured: boolean;
  /** 依次执行（各自提交）；任何一条出错就抛。返回每条的结果行。 */
  execute(stmts: readonly Stmt[]): Promise<Row[][]>;
  /** 一个事务里执行，任何一步失败就整体回滚并抛。返回每条的结果行。 */
  transaction(stmts: readonly Stmt[]): Promise<Row[][]>;
}
