/**
 * 最小的 Turso / libSQL HTTP 客户端（Hrana over HTTP，`POST {url}/v2/pipeline`）。
 * Worker 里用（STORAGE_BACKEND=turso，默认），scripts/copy-storage.ts 也用；数据库凭据 TURSO_DB_TOKEN 不出 Worker。
 */
import { DbError, type Row, type SqlDb, type Stmt, type Value } from './sql';

export interface TursoEnv {
  /** 如 https://mindough-rei8.aws-ap-northeast-1.turso.io（libsql:// 也行，会换成 https://） */
  TURSO_DB_URL?: string;
  TURSO_DB_TOKEN?: string;
}

export type { Row, Stmt, Value } from './sql';

type HranaValue = { type: 'null' } | { type: 'integer'; value: string } | { type: 'float'; value: number } | { type: 'text'; value: string } | { type: 'blob'; base64: string };

export class TursoError extends DbError {
  constructor(message: string, status = 502) {
    super(message, status);
    this.name = 'TursoError';
  }
}

export const tursoConfigured = (env: TursoEnv) => !!(env.TURSO_DB_URL && env.TURSO_DB_TOKEN);

function baseUrl(env: TursoEnv): string {
  return env.TURSO_DB_URL!.replace(/^libsql:\/\//, 'https://').replace(/\/+$/, '');
}

function encode(v: Value): HranaValue {
  if (v === null) return { type: 'null' };
  if (typeof v === 'number') return Number.isInteger(v) ? { type: 'integer', value: String(v) } : { type: 'float', value: v };
  return { type: 'text', value: v };
}

function decode(v: HranaValue): Value {
  switch (v.type) {
    case 'null':
      return null;
    case 'integer':
      return Number(v.value);
    case 'float':
      return v.value;
    case 'text':
      return v.value;
    default:
      return null;
  }
}

const stmtOf = (s: Stmt) => ({ sql: s.sql, args: (s.args ?? []).map(encode) });

interface ExecResult {
  cols: Array<{ name: string }>;
  rows: HranaValue[][];
  affected_row_count: number;
}

function rowsOf(r: ExecResult): Row[] {
  return r.rows.map((vals) => Object.fromEntries(r.cols.map((c, i) => [c.name, decode(vals[i]!)])));
}

async function pipeline(env: TursoEnv, requests: unknown[], fetcher: typeof fetch): Promise<Array<{ type: string; response?: any; error?: { message: string } }>> {
  if (!tursoConfigured(env)) throw new TursoError('503 服务不可用：同步数据库还没配置', 503);
  let res: Response;
  try {
    res = await fetcher(`${baseUrl(env)}/v2/pipeline`, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.TURSO_DB_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ requests: [...requests, { type: 'close' }] }),
    });
  } catch (e) {
    throw new TursoError(`502 网关错误：连不上同步数据库（${String(e)}）`);
  }
  if (!res.ok) throw new TursoError(`502 网关错误：同步数据库返回 ${res.status}`);
  const body = (await res.json()) as { results: Array<{ type: string; response?: any; error?: { message: string } }> };
  return body.results;
}

/** 依次执行（各自提交）；任何一条出错就抛。返回每条的结果行。 */
export async function execute(env: TursoEnv, stmts: readonly Stmt[], fetcher: typeof fetch = fetch): Promise<Row[][]> {
  const results = await pipeline(
    env,
    stmts.map((s) => ({ type: 'execute', stmt: stmtOf(s) })),
    fetcher,
  );
  return stmts.map((_, i) => {
    const r = results[i];
    if (!r || r.type !== 'ok') throw new TursoError(`502 网关错误：${r?.error?.message ?? '同步数据库没有返回结果'}`);
    return rowsOf(r.response.result as ExecResult);
  });
}

/** 一个事务里执行（BEGIN … COMMIT，任何一步失败就 ROLLBACK 并抛）。返回每条的结果行。 */
export async function transaction(env: TursoEnv, stmts: readonly Stmt[], fetcher: typeof fetch = fetch): Promise<Row[][]> {
  const steps: unknown[] = [{ stmt: { sql: 'BEGIN IMMEDIATE' } }];
  stmts.forEach((s, i) => steps.push({ stmt: stmtOf(s), condition: { type: 'ok', step: i } }));
  const commitAt = steps.length;
  steps.push({ stmt: { sql: 'COMMIT' }, condition: { type: 'ok', step: commitAt - 1 } });
  steps.push({ stmt: { sql: 'ROLLBACK' }, condition: { type: 'not', cond: { type: 'ok', step: commitAt } } });
  const [r] = await pipeline(env, [{ type: 'batch', batch: { steps } }], fetcher);
  if (!r || r.type !== 'ok') throw new TursoError(`502 网关错误：${r?.error?.message ?? '同步数据库没有返回结果'}`);
  const batch = r.response.result as { step_results: Array<ExecResult | null>; step_errors: Array<{ message: string } | null> };
  const err = batch.step_errors.find((e) => e);
  if (err || !batch.step_results[commitAt]) throw new TursoError(`502 网关错误：写入同步数据库失败（${err?.message ?? '未提交'}）`);
  return stmts.map((_, i) => rowsOf(batch.step_results[i + 1]!));
}

/** 存储层接口（sql.ts）的 Turso 实现。 */
export function tursoDb(env: TursoEnv, fetcher: typeof fetch = fetch): SqlDb {
  return {
    backend: 'turso',
    configured: tursoConfigured(env),
    execute: (stmts) => execute(env, stmts, fetcher),
    transaction: (stmts) => transaction(env, stmts, fetcher),
  };
}
