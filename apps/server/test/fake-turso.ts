/// <reference types="node" />
/**
 * 假 Turso：用 node:sqlite 实现 Hrana `/v2/pipeline` 的 execute / batch（带 condition），
 * 让 Worker 的真实 SQL（upsert、RETURNING、编号参数）在单测里真跑一遍。
 */
import { DatabaseSync } from 'node:sqlite';

type HV = { type: 'null' } | { type: 'integer'; value: string } | { type: 'float'; value: number } | { type: 'text'; value: string };
type Cond = { type: 'ok'; step: number } | { type: 'error'; step: number } | { type: 'not'; cond: Cond } | { type: 'and'; conds: Cond[] } | { type: 'or'; conds: Cond[] };

const dec = (v: HV) => (v.type === 'null' ? null : v.type === 'integer' ? Number(v.value) : v.value);
const enc = (v: unknown): HV =>
  v === null || v === undefined
    ? { type: 'null' }
    : typeof v === 'number' || typeof v === 'bigint'
      ? Number.isInteger(Number(v))
        ? { type: 'integer', value: String(v) }
        : { type: 'float', value: Number(v) }
      : { type: 'text', value: String(v) };

export class FakeTurso {
  readonly db = new DatabaseSync(':memory:');
  requests = 0;
  /** 置为 true 时返回 500。 */
  broken = false;
  readonly url = 'https://fake-db.turso.io';
  readonly token = 'fake-db-token';

  private exec(stmt: { sql: string; args?: HV[] }) {
    const st = this.db.prepare(stmt.sql);
    const args = (stmt.args ?? []).map(dec) as Array<string | number | null>;
    const isQuery = /^\s*(select|with)\b/i.test(stmt.sql) || /\breturning\b/i.test(stmt.sql);
    if (isQuery) {
      const rows = st.all(...args) as Array<Record<string, unknown>>;
      const cols = rows[0] ? Object.keys(rows[0]) : st.columns().map((c) => c.name);
      return { cols: cols.map((name) => ({ name })), rows: rows.map((r) => cols.map((c) => enc(r[c]))), affected_row_count: rows.length };
    }
    const r = st.run(...args);
    return { cols: [], rows: [], affected_row_count: Number(r.changes) };
  }

  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input instanceof Request ? input.url : input);
    if (url !== `${this.url}/v2/pipeline`) throw new Error(`没想到的请求：${url}`);
    if (new Headers(init?.headers).get('authorization') !== `Bearer ${this.token}`) return new Response('unauthorized', { status: 401 });
    if (this.broken) return new Response('boom', { status: 500 });
    this.requests++;
    const body = JSON.parse(String(init?.body)) as { requests: any[] };
    const results = body.requests.map((r) => {
      if (r.type === 'close') return { type: 'ok', response: { type: 'close' } };
      if (r.type === 'execute') {
        try {
          return { type: 'ok', response: { type: 'execute', result: this.exec(r.stmt) } };
        } catch (e) {
          return { type: 'error', error: { message: String(e) } };
        }
      }
      if (r.type === 'batch') {
        const step_results: unknown[] = [];
        const step_errors: unknown[] = [];
        const ok = (c: Cond): boolean =>
          c.type === 'ok'
            ? !!step_results[c.step] && !step_errors[c.step]
            : c.type === 'error'
              ? !!step_errors[c.step]
              : c.type === 'not'
                ? !ok(c.cond)
                : c.type === 'and'
                  ? c.conds.every(ok)
                  : c.conds.some(ok);
        r.batch.steps.forEach((s: { stmt: any; condition?: Cond }, i: number) => {
          if (s.condition && !ok(s.condition)) {
            step_results[i] = null;
            step_errors[i] = null;
            return;
          }
          try {
            step_results[i] = this.exec(s.stmt);
            step_errors[i] = null;
          } catch (e) {
            step_results[i] = null;
            step_errors[i] = { message: String(e) };
          }
        });
        return { type: 'ok', response: { type: 'batch', result: { step_results, step_errors } } };
      }
      return { type: 'error', error: { message: 'unknown request' } };
    });
    return Response.json({ baton: null, base_url: null, results });
  };
}
