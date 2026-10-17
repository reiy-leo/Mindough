/**
 * 云端库之间全量复制（Turso ⇄ D1），给 scripts/copy-storage.ts 用；切换 STORAGE_BACKEND 之前先跑它。
 *
 * - 只复制 sync_row（全部用户、全部行，原样保留 seq，这样各设备手里的拉取游标切换后照样能用）。
 *   auth_code 是 5 分钟有效的一次性登录码，不复制；server_schema 由 applyMigrations 在目标库建好。
 * - 目标库已有同步数据时默认拒绝（409 冲突），要覆盖得显式 replace：只清目标库的 sync_row。
 * - 源库从头到尾只读，不删不改。
 * - 写完核对：总行数、每个用户的行数与最大 seq、每张业务表的行数，再逐行比对 (user, tbl, id, updated_at, deleted, seq, data) 的摘要；
 *   有任何一项对不上就抛错（并列出差异），这时不要切换。
 */
import { DbError, type SqlDb, type Stmt, type Value } from './sql';
import { applyMigrations } from './sync';

export interface CopyOptions {
  /** 目标库已有 sync_row 时清掉再复制（只动目标库）。默认 false：目标非空就 409。 */
  replace?: boolean;
  /** 只统计、核对源库，不写目标库。 */
  dryRun?: boolean;
  /** 每次读多少行（默认 200）。 */
  pageSize?: number;
  /** 每条 INSERT 带几行（每行 7 个参数；D1 每条最多 100 个参数 → 最多 14 行）。 */
  rowsPerInsert?: number;
  log?: (msg: string) => void;
}

export interface Census {
  total: number;
  users: Record<string, { rows: number; maxSeq: number }>;
  tables: Record<string, number>;
}

export interface CopyReport {
  from: SqlDb['backend'];
  to: SqlDb['backend'];
  dryRun: boolean;
  source: Census;
  target: Census | null;
  copied: number;
  /** 源库 / 目标库逐行摘要（dryRun 时目标为 null） */
  sourceDigest: string;
  targetDigest: string | null;
}

const MAX_GROUP_BYTES = 1_000_000;
const COLS = ['user_id', 'tbl', 'id', 'updated_at', 'deleted', 'data', 'seq'] as const;
const Q = (c: string) => `"${c}"`;

export async function census(db: SqlDb): Promise<Census> {
  const [tot, users, tables] = await db.execute([
    { sql: `SELECT COUNT(*) AS n FROM "sync_row"` },
    { sql: `SELECT "user_id" AS u, COUNT(*) AS n, MAX("seq") AS s FROM "sync_row" GROUP BY "user_id" ORDER BY "user_id"` },
    { sql: `SELECT "tbl" AS t, COUNT(*) AS n FROM "sync_row" GROUP BY "tbl" ORDER BY "tbl"` },
  ]);
  return {
    total: Number(tot?.[0]?.n ?? 0),
    users: Object.fromEntries((users ?? []).map((r) => [String(r.u), { rows: Number(r.n), maxSeq: Number(r.s) }])),
    tables: Object.fromEntries((tables ?? []).map((r) => [String(r.t), Number(r.n)])),
  };
}

type Key = [string, string, string];

/** 按主键 (user_id, tbl, id) 顺序翻页读出全部行（keyset，不用 OFFSET）。 */
async function* readAll(db: SqlDb, pageSize: number): AsyncGenerator<Record<string, Value>[]> {
  let after: Key | null = null;
  for (;;) {
    const where = after ? `WHERE ("user_id" > ?1) OR ("user_id" = ?1 AND "tbl" > ?2) OR ("user_id" = ?1 AND "tbl" = ?2 AND "id" > ?3) ` : '';
    const [rows] = await db.execute([
      {
        sql: `SELECT ${COLS.map(Q).join(', ')} FROM "sync_row" ${where}ORDER BY "user_id", "tbl", "id" LIMIT ${Math.max(1, pageSize)}`,
        args: after ?? [],
      },
    ]);
    if (!rows?.length) return;
    yield rows;
    const last = rows.at(-1)!;
    after = [String(last.user_id), String(last.tbl), String(last.id)];
    if (rows.length < pageSize) return;
  }
}

/** 逐行摘要：SHA-256( 每行 user\ttbl\tid\tupdated_at\tdeleted\tseq\tSHA-256(data) )，行按主键排序。 */
async function digest(db: SqlDb, pageSize: number): Promise<string> {
  const enc = new TextEncoder();
  const parts: string[] = [];
  for await (const page of readAll(db, pageSize)) {
    for (const r of page) {
      const d = await sha256(enc.encode(String(r.data)));
      parts.push([r.user_id, r.tbl, r.id, r.updated_at, Number(r.deleted), Number(r.seq), d].join('\t'));
    }
  }
  return sha256(enc.encode(parts.join('\n')));
}

async function sha256(buf: Uint8Array): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
  return Array.from(h, (b) => b.toString(16).padStart(2, '0')).join('');
}

function diffCensus(a: Census, b: Census): string[] {
  const out: string[] = [];
  if (a.total !== b.total) out.push(`总行数 ${a.total} ≠ ${b.total}`);
  for (const u of new Set([...Object.keys(a.users), ...Object.keys(b.users)])) {
    const x = a.users[u];
    const y = b.users[u];
    if (x?.rows !== y?.rows || x?.maxSeq !== y?.maxSeq) out.push(`用户 ${u}：行数 ${x?.rows ?? 0} / 最大 seq ${x?.maxSeq ?? '-'} ≠ ${y?.rows ?? 0} / ${y?.maxSeq ?? '-'}`);
  }
  for (const t of new Set([...Object.keys(a.tables), ...Object.keys(b.tables)])) if (a.tables[t] !== b.tables[t]) out.push(`表 ${t}：${a.tables[t] ?? 0} ≠ ${b.tables[t] ?? 0}`);
  return out;
}

export async function copyStorage(from: SqlDb, to: SqlDb, opts: CopyOptions = {}): Promise<CopyReport> {
  const log = opts.log ?? (() => {});
  const pageSize = opts.pageSize ?? 200;
  const perInsert = Math.max(1, Math.min(opts.rowsPerInsert ?? 14, 14));
  if (from === to) throw new DbError('400 请求有误：源库和目标库是同一个');

  const source = await census(from);
  const sourceDigest = await digest(from, pageSize);
  log(`源库（${from.backend}）：${source.total} 行，${Object.keys(source.users).length} 个用户`);
  if (opts.dryRun) return { from: from.backend, to: to.backend, dryRun: true, source, target: null, copied: 0, sourceDigest, targetDigest: null };

  await applyMigrations(to);
  const before = await census(to);
  if (before.total > 0) {
    if (!opts.replace) throw new DbError(`409 冲突：目标库（${to.backend}）里已经有 ${before.total} 行同步数据；确认要覆盖目标库就加 --replace（源库不会动）`, 409);
    log(`清空目标库（${to.backend}）的 sync_row：${before.total} 行`);
    await to.execute([{ sql: `DELETE FROM "sync_row"` }]);
  }

  let copied = 0;
  for await (const page of readAll(from, pageSize)) {
    const stmts: Stmt[] = [];
    for (let i = 0; i < page.length; i += perInsert) {
      const chunk = page.slice(i, i + perInsert);
      stmts.push({
        sql: `INSERT INTO "sync_row" (${COLS.map(Q).join(', ')}) VALUES ${chunk.map(() => `(${COLS.map(() => '?').join(', ')})`).join(', ')}`,
        args: chunk.flatMap((r) => COLS.map((c) => (c === 'deleted' || c === 'seq' ? Number(r[c]) : (r[c] ?? null)))),
      });
    }
    // 一组一个事务（每组请求体不超过约 1 MB）；某组失败就停下（目标库可能写了一半，重跑时加 --replace）
    let group: Stmt[] = [];
    let bytes = 0;
    for (const st of stmts) {
      const size = (st.args ?? []).reduce<number>((n, v) => n + (typeof v === 'string' ? v.length : 8), st.sql.length);
      if (group.length && bytes + size > MAX_GROUP_BYTES) {
        await to.transaction(group);
        group = [];
        bytes = 0;
      }
      group.push(st);
      bytes += size;
    }
    if (group.length) await to.transaction(group);
    copied += page.length;
    log(`已复制 ${copied} / ${source.total}`);
  }

  const target = await census(to);
  const targetDigest = await digest(to, pageSize);
  const diffs = diffCensus(source, target);
  if (sourceDigest !== targetDigest) diffs.push('逐行摘要对不上');
  if (diffs.length) throw new DbError(`500 服务器内部错误：复制后核对失败，不要切换——${diffs.join('；')}`, 500);
  log(`核对通过：${target.total} 行，摘要 ${targetDigest.slice(0, 12)}…`);
  return { from: from.backend, to: to.backend, dryRun: false, source, target, copied, sourceDigest, targetDigest };
}
