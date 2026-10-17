/// <reference types="node" />
/**
 * 云端存储层（Rei 2026-10-17）：STORAGE_BACKEND 选后端、D1 实现（Miniflare 的本地 D1，真 SQLite + D1 batch 语义）、
 * 同步 API 在 D1 上整套跑通、Turso ⇄ D1 全量复制与核对。
 */
import { Miniflare } from 'miniflare';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { handle, type Env } from '../src/index';
import { sign } from '../src/session';
import { applyMigrations, resetSchemaCache } from '../src/sync';
import { d1Db, type D1Like } from '../src/d1';
import { openDb, storageBackend } from '../src/storage';
import { tursoDb } from '../src/turso';
import { copyStorage, census } from '../src/copy';
import { DbError, type SqlDb } from '../src/sql';
import { issueNativeCode, sha256b64url } from '../src/native';
import { FakeTurso } from './fake-turso';

const ORIGIN = 'https://mindough.rei8t.dev';
let mf: Miniflare;
let n = 0;

beforeAll(() => {
  mf = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response(null) } }', d1Databases: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`DB${i + 1}`, `db${i + 1}`])) });
});
afterAll(async () => {
  await mf.dispose();
});

/** 每个用例一个干净的本地 D1。 */
async function freshD1(): Promise<D1Like> {
  n++;
  const db = (await mf.getD1Database(`DB${n}`)) as unknown as D1Like;
  return db;
}

describe('STORAGE_BACKEND', () => {
  it('没设 / turso → turso；d1 → d1；大小写空格不计；别的值 → null', () => {
    expect(storageBackend({})).toBe('turso');
    expect(storageBackend({ STORAGE_BACKEND: '' })).toBe('turso');
    expect(storageBackend({ STORAGE_BACKEND: 'turso' })).toBe('turso');
    expect(storageBackend({ STORAGE_BACKEND: ' D1 ' })).toBe('d1');
    expect(storageBackend({ STORAGE_BACKEND: 'postgres' })).toBeNull();
  });

  it('写错了不悄悄回退：openDb 抛 503 并说清楚', async () => {
    const db = openDb({ STORAGE_BACKEND: 'tursoo' });
    expect(db.configured).toBe(false);
    await expect(db.execute([{ sql: 'SELECT 1' }])).rejects.toThrow('503 服务不可用：STORAGE_BACKEND 只能是 turso 或 d1（现在是「tursoo」）');
  });

  it('d1 但没绑定 → 503', async () => {
    const db = openDb({ STORAGE_BACKEND: 'd1' });
    expect(db.backend).toBe('d1');
    expect(db.configured).toBe(false);
    await expect(db.execute([{ sql: 'SELECT 1' }])).rejects.toMatchObject({ status: 503 });
  });
});

describe('D1 存储层（本地 D1）', () => {
  it('execute：编号参数、RETURNING、null', async () => {
    const db = d1Db(await freshD1());
    const [a] = await db.execute([{ sql: 'SELECT ?1 AS a, ?2 AS b, ?1 AS c', args: [7, null] }]);
    expect(a).toEqual([{ a: 7, b: null, c: 7 }]);
  });

  it('transaction 是原子的：中间一步出错，前面的也回滚，并抛 500 服务器内部错误', async () => {
    const db = d1Db(await freshD1());
    await db.execute([{ sql: 'CREATE TABLE t (a INTEGER PRIMARY KEY)' }]);
    await expect(
      db.transaction([
        { sql: 'INSERT INTO t VALUES (1)' },
        { sql: 'INSERT INTO t VALUES (1)' }, // 主键冲突
      ]),
    ).rejects.toThrow(/^500 服务器内部错误：D1 数据库出错/);
    const [rows] = await db.execute([{ sql: 'SELECT COUNT(*) AS n FROM t' }]);
    expect(rows![0]!.n).toBe(0);
  });

  it('同一套 SERVER_MIGRATIONS 能应用到 D1，重复应用不出错', async () => {
    const db = d1Db(await freshD1());
    await applyMigrations(db);
    await applyMigrations(db);
    const [tables] = await db.execute([{ sql: `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_cf%' ESCAPE '\\' AND name NOT LIKE 'sqlite%' ORDER BY name` }]);
    expect(tables!.map((r) => r.name)).toEqual(['auth_code', 'server_schema', 'sync_row']);
  });
});

describe('同步 API 跑在 D1 上（STORAGE_BACKEND=d1）', () => {
  let env: Env;
  beforeEach(async () => {
    resetSchemaCache();
    env = {
      GOOGLE_CLIENT_ID: 'cid',
      GOOGLE_CLIENT_SECRET: 'csecret',
      SESSION_SECRET: 'test-secret-0123456789',
      ALLOWED_EMAILS: 'reiy.leoz@gmail.com',
      STORAGE_BACKEND: 'd1',
      DB: await freshD1(),
    };
    // D1 模式下不该去连 Turso
    vi.stubGlobal('fetch', async (u: unknown) => {
      throw new Error(`不该有网络请求：${String(u)}`);
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  const req = (path: string, init: { method?: string; cookie?: string; bearer?: string; body?: unknown } = {}) => {
    const headers = new Headers();
    if (init.cookie) headers.set('cookie', init.cookie);
    if (init.bearer) headers.set('authorization', `Bearer ${init.bearer}`);
    return new Request(ORIGIN + path, { method: init.method ?? 'GET', headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  };
  const session = () => sign({ sub: '1', email: 'reiy.leoz@gmail.com', name: 'Rei', picture: null, exp: Date.now() + 60_000 }, env.SESSION_SECRET!);
  const row = (id: string, updated_at: string, body_md = id) => ({ table: 'task', id, updated_at, deleted: false, row: { id, updated_at, deleted: false, body_md } });

  it('/api/health 与 /api/sync/token 都报当前后端', async () => {
    expect(await (await handle(req('/api/health'), env)).json()).toMatchObject({ ok: true, storage: 'd1' });
    const t = await handle(req('/api/sync/token', { method: 'POST', cookie: `md_session=${encodeURIComponent(await session())}` }), env);
    expect(t.status).toBe(200);
    expect(await t.json()).toMatchObject({ storage: 'd1' });
    expect(await (await handle(req('/api/health'), { ...env, STORAGE_BACKEND: undefined })).json()).toMatchObject({ storage: 'turso' });
    expect(await (await handle(req('/api/health'), { ...env, STORAGE_BACKEND: 'x' })).json()).toMatchObject({ storage: null });
  });

  it('STORAGE_BACKEND 写错了：取同步凭据 503，附中文说明', async () => {
    const res = await handle(req('/api/sync/token', { method: 'POST', cookie: `md_session=${encodeURIComponent(await session())}` }), { ...env, STORAGE_BACKEND: 'mysql' });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toContain('503 服务不可用：STORAGE_BACKEND 只能是 turso 或 d1');
  });

  it('推、拉、行级 LWW、seq 游标，和 Turso 上一样', async () => {
    const tok = await handle(req('/api/sync/token', { method: 'POST', bearer: await session() }), env);
    const { token } = (await tok.json()) as { token: string };
    const push = async (rows: unknown[]) => (await handle(req('/api/sync/push', { method: 'POST', bearer: token, body: { rows } }), env)).json();
    const pull = async (cursor: number, limit = 500) =>
      (await (await handle(req('/api/sync/pull', { method: 'POST', bearer: token, body: { cursor, limit } }), env)).json()) as { rows: Array<Record<string, any>>; cursor: number; more: boolean };

    expect(await push([row('a', '0000000001000-0000-devA'), row('b', '0000000001000-0001-devA')])).toEqual({ applied: 2 });
    expect(await push([row('a', '0000000000500-0000-devB', '旧')])).toEqual({ applied: 0 });
    expect(await push([row('a', '0000000002000-0000-devB', '新')])).toEqual({ applied: 1 });
    const all = await pull(0);
    expect(all.rows.map((r) => [r.id, r.seq, r.row.body_md])).toEqual([
      ['b', 2, 'b'],
      ['a', 3, '新'],
    ]);
    const p1 = await pull(0, 1);
    expect(p1).toMatchObject({ cursor: 2, more: true });
    expect((await pull(p1.cursor)).rows.map((r) => r.id)).toEqual(['a']);
  });

  it('原生端一次性登录码也存在 D1', async () => {
    const verifier = 'v'.repeat(43);
    const code = await issueNativeCode(env, { sub: '1', email: 'reiy.leoz@gmail.com', name: 'Rei', picture: null, exp: Date.now() + 60_000 }, await sha256b64url(verifier));
    const ex = (body: unknown) => handle(req('/auth/exchange', { method: 'POST', body }), env);
    expect((await ex({ code, verifier })).status).toBe(200);
    expect((await ex({ code, verifier })).status).toBe(400); // 只能用一次
  });
});

describe('Turso ⇄ D1 全量复制（scripts/copy-storage.ts 的核心）', () => {
  let turso: FakeTurso;
  let tdb: SqlDb;
  let ddb: SqlDb;

  /** 往库里写 n 行（两个用户，seq 各自递增、有空洞）。 */
  async function seed(db: SqlDb, count: number) {
    await applyMigrations(db);
    const stmts = [];
    for (let i = 0; i < count; i++) {
      const user = i % 3 === 0 ? 'other@example.com' : 'reiy.leoz@gmail.com';
      const tbl = ['task', 'check_in', 'library_item'][i % 3]!;
      const data = JSON.stringify({ id: `id-${i}`, body_md: `第 ${i} 条 ✓`, deleted: i % 7 === 0 });
      stmts.push({ sql: `INSERT INTO "sync_row" VALUES (?, ?, ?, ?, ?, ?, ?)`, args: [user, tbl, `id-${String(i).padStart(4, '0')}`, `00000000${1000 + i}-0000-dev`, i % 7 === 0 ? 1 : 0, data, i * 2 + 5] });
    }
    for (let i = 0; i < stmts.length; i += 50) await db.transaction(stmts.slice(i, i + 50));
  }

  beforeEach(async () => {
    turso = new FakeTurso();
    tdb = tursoDb({ TURSO_DB_URL: turso.url, TURSO_DB_TOKEN: turso.token }, turso.fetch);
    ddb = d1Db(await freshD1());
  });

  it('Turso → D1：全部行原样过去（含 seq、墓碑、中文），行数与逐行摘要一致；源库不变', async () => {
    await seed(tdb, 103);
    const before = await census(tdb);
    const r = await copyStorage(tdb, ddb, { pageSize: 17 });
    expect(r.copied).toBe(103);
    expect(r.target).toEqual(r.source);
    expect(r.targetDigest).toBe(r.sourceDigest);
    expect(r.source.users['reiy.leoz@gmail.com']).toEqual({ rows: 68, maxSeq: 207 });
    expect(await census(tdb)).toEqual(before);
    const [x] = await ddb.execute([{ sql: `SELECT * FROM "sync_row" WHERE "id" = 'id-0007'` }]);
    expect(x![0]).toMatchObject({ seq: 19, deleted: 1, data: JSON.stringify({ id: 'id-7', body_md: '第 7 条 ✓', deleted: true }) });
  });

  it('D1 → Turso 反向也行', async () => {
    await seed(ddb, 40);
    const r = await copyStorage(ddb, tdb);
    expect(r.copied).toBe(40);
    expect(r.targetDigest).toBe(r.sourceDigest);
  });

  it('目标库已有数据：默认 409 冲突、一行不动；--replace 才清掉目标库再复制', async () => {
    await seed(tdb, 10);
    await seed(ddb, 3);
    const err = await copyStorage(tdb, ddb).catch((e) => e);
    expect(err).toBeInstanceOf(DbError);
    expect(err.status).toBe(409);
    expect(err.message).toMatch(/^409 冲突：目标库（d1）里已经有 3 行同步数据/);
    expect((await census(ddb)).total).toBe(3);
    const r = await copyStorage(tdb, ddb, { replace: true });
    expect(r.target!.total).toBe(10);
    expect((await census(tdb)).total).toBe(10);
  });

  it('--dry-run 只统计源库，不碰目标库', async () => {
    await seed(tdb, 5);
    const r = await copyStorage(tdb, ddb, { dryRun: true });
    expect(r).toMatchObject({ dryRun: true, copied: 0, target: null });
    expect(r.source.total).toBe(5);
    const [t] = await ddb.execute([{ sql: `SELECT name FROM sqlite_master WHERE name = 'sync_row'` }]);
    expect(t).toEqual([]);
  });

  it('写进去的跟源库对不上（丢行 / 改值）就报错，提示不要切换', async () => {
    await seed(tdb, 30);
    // 坏目标：每次事务悄悄丢掉最后一条 INSERT
    const lossy: SqlDb = { ...ddb, transaction: (s) => ddb.transaction(s.length > 1 && /^INSERT INTO "sync_row"/.test(s.at(-1)!.sql) ? s.slice(0, -1) : s) };
    await expect(copyStorage(tdb, lossy, { pageSize: 30, rowsPerInsert: 10 })).rejects.toThrow(/核对失败，不要切换——总行数 30 ≠ 20/);

    // 行数对得上但内容变了：只有逐行摘要能发现
    const ddb2 = d1Db(await freshD1());
    const tamper: SqlDb = {
      ...ddb2,
      transaction: (s) => ddb2.transaction(s.map((x) => (x.args ? { ...x, args: x.args.map((v) => (v === `00000000${1003}-0000-dev` ? `00000000${1003}-0000-xxx` : v)) } : x))),
    };
    await expect(copyStorage(tdb, tamper)).rejects.toThrow(/逐行摘要对不上/);
  });
});
