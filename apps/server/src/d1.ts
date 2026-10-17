/**
 * 存储层接口（sql.ts）的 Cloudflare D1 实现。
 * - d1Db：Worker 里用绑定 env.DB（wrangler 配置的 d1_databases，库名 mindough）；事务用 D1 的 batch（整批原子执行）。
 * - d1RestDb：Worker 外（scripts/copy-storage.ts 迁移脚本）用 Cloudflare REST API
 *   `POST /accounts/{account}/d1/database/{id}/query`，{ batch: [...] } 一次发多条。
 */
import { DbError, type Row, type SqlDb, type Stmt, type Value } from './sql';

/** D1 绑定里用到的那一小部分（与 @cloudflare/workers-types 的 D1Database 兼容，单测可用 Miniflare 的真 D1）。 */
export interface D1Like {
  prepare(sql: string): D1StmtLike;
  batch(stmts: D1StmtLike[]): Promise<Array<{ results?: unknown[] }>>;
}
export interface D1StmtLike {
  bind(...values: unknown[]): D1StmtLike;
  all(): Promise<{ results?: unknown[] }>;
}

/** D1 每条语句最多绑定 100 个参数（迁移脚本按这个拆批）。 */
export const D1_MAX_PARAMS = 100;

const norm = (r: unknown): Row => {
  const out: Row = {};
  for (const [k, v] of Object.entries(r as Record<string, unknown>)) out[k] = v === undefined ? null : typeof v === 'bigint' ? Number(v) : (v as Value);
  return out;
};

function d1Error(e: unknown): DbError {
  if (e instanceof DbError) return e;
  return new DbError(`500 服务器内部错误：D1 数据库出错（${e instanceof Error ? e.message : String(e)}）`, 500);
}

export function d1Db(binding: D1Like | undefined): SqlDb {
  const need = (): D1Like => {
    if (!binding) throw new DbError('503 服务不可用：D1 数据库还没绑定（wrangler 配置里的 d1_databases，binding = DB）', 503);
    return binding;
  };
  const prep = (db: D1Like, s: Stmt) => (s.args?.length ? db.prepare(s.sql).bind(...s.args) : db.prepare(s.sql));
  return {
    backend: 'd1',
    configured: !!binding,
    async execute(stmts) {
      const db = need();
      const out: Row[][] = [];
      try {
        for (const s of stmts) out.push(((await prep(db, s).all()).results ?? []).map(norm));
      } catch (e) {
        throw d1Error(e);
      }
      return out;
    },
    async transaction(stmts) {
      const db = need();
      if (!stmts.length) return [];
      try {
        const res = await db.batch(stmts.map((s) => prep(db, s)));
        return res.map((r) => (r.results ?? []).map(norm));
      } catch (e) {
        throw d1Error(e);
      }
    },
  };
}

export interface D1RestConfig {
  accountId: string;
  databaseId: string;
  apiToken: string;
}

/** 迁移脚本用：经 Cloudflare REST API 读写 D1。execute 与 transaction 都是一次 batch 请求（D1 对 batch 整批原子执行）。 */
export function d1RestDb(cfg: D1RestConfig, fetcher: typeof fetch = fetch): SqlDb {
  const run = async (stmts: readonly Stmt[]): Promise<Row[][]> => {
    if (!stmts.length) return [];
    let res: Response;
    try {
      res = await fetcher(`https://api.cloudflare.com/client/v4/accounts/${cfg.accountId}/d1/database/${cfg.databaseId}/query`, {
        method: 'POST',
        headers: { authorization: `Bearer ${cfg.apiToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ batch: stmts.map((s) => ({ sql: s.sql, params: [...(s.args ?? [])] })) }),
      });
    } catch (e) {
      throw new DbError(`502 网关错误：连不上 Cloudflare D1 API（${String(e)}）`);
    }
    const body = (await res.json().catch(() => null)) as { success?: boolean; errors?: Array<{ message: string }>; result?: Array<{ results?: unknown[]; success?: boolean }> } | null;
    if (!res.ok || !body?.success) {
      const why = body?.errors?.map((e) => e.message).join('；') || `HTTP ${res.status}`;
      throw new DbError(`502 网关错误：D1 API 返回错误（${why}）`);
    }
    return (body.result ?? []).map((r) => (r.results ?? []).map(norm));
  };
  return { backend: 'd1', configured: true, execute: run, transaction: run };
}
