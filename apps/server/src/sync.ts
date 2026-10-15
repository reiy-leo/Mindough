/**
 * 同步 API（M2）。云端存储是 Turso Cloud 数据库 `mindough`（org rei8，东京），Worker 经 Hrana HTTP 读写；
 * 数据库凭据只在 Worker 里，客户端拿到的是 Worker 自己签的短期同步凭据（1 小时）。
 *
 * - POST /api/sync/token  会话（cookie 或原生端的 Bearer 会话）→ { url, token, expires_at }；
 *                         401 未登录 / 403 无权限（不在 ALLOWED_EMAILS 里）
 * - POST /api/sync/push   Bearer 同步凭据，{ rows: WireRow[] } → { applied }
 * - POST /api/sync/pull   Bearer 同步凭据，{ cursor, limit } → { rows, cursor, more }
 *
 * 规则与 packages/core/src/sync/memory-remote.ts 一致：行级 LWW（updated_at 更大才覆盖），每次采纳 seq 加一
 * （每个用户各自递增），按 seq 游标分页拉取。云端不关心业务列：整行存 JSON。
 */
import { allowedEmails, currentSession, type AuthEnv } from './auth';
import { sign, verify } from './session';
import { execute, transaction, TursoError, type Stmt, type TursoEnv } from './turso';

export interface SyncEnv extends AuthEnv, TursoEnv {}

export const SYNC_TOKEN_TTL_S = 3600;
const MAX_ROWS = 500;
const MAX_ROW_BYTES = 2 * 1024 * 1024;
const MAX_PULL = 1000;

/** 云端 schema（只追加）。Worker 第一次用到时确保已应用；也可用 scripts/migrate-remote.mjs 手动跑。 */
export const SERVER_MIGRATIONS: ReadonlyArray<{ version: number; name: string; sql: string[] }> = [
  {
    version: 1,
    name: '同步行 + 原生端一次性登录码',
    sql: [
      `CREATE TABLE IF NOT EXISTS "sync_row" ("user_id" TEXT NOT NULL, "tbl" TEXT NOT NULL, "id" TEXT NOT NULL, "updated_at" TEXT NOT NULL, "deleted" INTEGER NOT NULL DEFAULT 0, "data" TEXT NOT NULL, "seq" INTEGER NOT NULL, PRIMARY KEY ("user_id", "tbl", "id"))`,
      `CREATE INDEX IF NOT EXISTS "sync_row_user_seq" ON "sync_row" ("user_id", "seq")`,
      `CREATE TABLE IF NOT EXISTS "auth_code" ("code" TEXT PRIMARY KEY NOT NULL, "payload" TEXT NOT NULL, "challenge" TEXT NOT NULL, "expires_at" INTEGER NOT NULL, "used" INTEGER NOT NULL DEFAULT 0)`,
    ],
  },
];

let schemaReady: Promise<void> | null = null;

export async function ensureSchema(env: TursoEnv, fetcher: typeof fetch = fetch): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      const [rows] = await execute(
        env,
        [
          { sql: `CREATE TABLE IF NOT EXISTS "server_schema" ("version" INTEGER PRIMARY KEY NOT NULL, "name" TEXT NOT NULL, "applied_at" TEXT NOT NULL)` },
          { sql: `SELECT COALESCE(MAX("version"), 0) AS v FROM "server_schema"` },
        ],
        fetcher,
      ).then((r) => [r[1]!]);
      const current = Number(rows?.[0]?.v ?? 0);
      for (const m of SERVER_MIGRATIONS) {
        if (m.version <= current) continue;
        await transaction(
          env,
          [...m.sql.map((sql) => ({ sql })), { sql: `INSERT OR IGNORE INTO "server_schema" ("version", "name", "applied_at") VALUES (?, ?, ?)`, args: [m.version, m.name, new Date().toISOString()] }],
          fetcher,
        );
      }
    })().catch((e) => {
      schemaReady = null;
      throw e;
    });
  }
  return schemaReady;
}

/** 测试用：重置“已确保 schema”的缓存。 */
export function resetSchemaCache() {
  schemaReady = null;
}

const json = (data: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra } });

interface SyncClaims {
  k: 'sync';
  email: string;
  exp: number;
}

export async function handleSyncToken(req: Request, env: SyncEnv): Promise<Response> {
  const s = await currentSession(req, env);
  if (s.status === 401) return json({ error: '401 未登录' }, 401);
  if (s.status === 403) return json({ error: '403 无权限：这个账户不在允许同步的名单里' }, 403);
  if (!env.TURSO_DB_URL || !env.TURSO_DB_TOKEN) return json({ error: '503 服务不可用：同步数据库还没配置' }, 503);
  const exp = Date.now() + SYNC_TOKEN_TTL_S * 1000;
  const token = await sign({ k: 'sync', email: s.user.email.toLowerCase(), exp } satisfies SyncClaims, env.SESSION_SECRET!);
  const origin = new URL(req.url).origin;
  return json({ url: `${origin}/api/sync`, token, expires_at: new Date(exp).toISOString() });
}

/** Bearer 同步凭据 → 邮箱；不对返回 401 / 403 的响应。 */
async function syncUser(req: Request, env: SyncEnv): Promise<string | Response> {
  const auth = req.headers.get('authorization') ?? '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m || !env.SESSION_SECRET) return json({ error: '401 未登录：缺少同步凭据' }, 401);
  const claims = await verify<SyncClaims>(m[1], env.SESSION_SECRET);
  if (!claims || claims.k !== 'sync' || typeof claims.email !== 'string') return json({ error: '401 未登录：同步凭据无效或已过期' }, 401);
  if (!allowedEmails(env).has(claims.email.toLowerCase())) return json({ error: '403 无权限' }, 403);
  return claims.email.toLowerCase();
}

interface WireRow {
  table: string;
  id: string;
  updated_at: string;
  deleted: boolean;
  row: Record<string, unknown>;
}

function validRow(r: unknown): r is WireRow {
  if (!r || typeof r !== 'object') return false;
  const x = r as Record<string, unknown>;
  return (
    typeof x.table === 'string' &&
    /^[a-z_]{1,40}$/.test(x.table) &&
    typeof x.id === 'string' &&
    x.id.length > 0 &&
    x.id.length <= 100 &&
    typeof x.updated_at === 'string' &&
    x.updated_at.length <= 100 &&
    !!x.row &&
    typeof x.row === 'object'
  );
}

const UPSERT =
  `INSERT INTO "sync_row" ("user_id", "tbl", "id", "updated_at", "deleted", "data", "seq") ` +
  `VALUES (?1, ?2, ?3, ?4, ?5, ?6, (SELECT COALESCE(MAX("seq"), 0) + 1 FROM "sync_row" WHERE "user_id" = ?1)) ` +
  `ON CONFLICT ("user_id", "tbl", "id") DO UPDATE SET "updated_at" = excluded."updated_at", "deleted" = excluded."deleted", "data" = excluded."data", "seq" = excluded."seq" ` +
  `WHERE excluded."updated_at" > "sync_row"."updated_at" RETURNING "seq"`;

export async function handlePush(req: Request, env: SyncEnv, fetcher: typeof fetch = fetch): Promise<Response> {
  const user = await syncUser(req, env);
  if (user instanceof Response) return user;
  let body: { rows?: unknown };
  try {
    body = (await req.json()) as { rows?: unknown };
  } catch {
    return json({ error: '400 请求有误：不是 JSON' }, 400);
  }
  const rows = body.rows;
  if (!Array.isArray(rows) || rows.length > MAX_ROWS || !rows.every(validRow)) return json({ error: `400 请求有误：rows 要是最多 ${MAX_ROWS} 行的数组` }, 400);
  const stmts: Stmt[] = [];
  for (const r of rows) {
    const data = JSON.stringify({ ...r.row, id: r.id, updated_at: r.updated_at, deleted: !!r.deleted });
    if (data.length > MAX_ROW_BYTES) return json({ error: '413 内容太大：单行超过 2 MB（图片请先上传）' }, 413);
    stmts.push({ sql: UPSERT, args: [user, r.table, r.id, r.updated_at, r.deleted ? 1 : 0, data] });
  }
  if (!stmts.length) return json({ applied: 0 });
  try {
    await ensureSchema(env, fetcher);
    const results = await transaction(env, stmts, fetcher);
    return json({ applied: results.filter((x) => x.length > 0).length });
  } catch (e) {
    return dbError(e);
  }
}

export async function handlePull(req: Request, env: SyncEnv, fetcher: typeof fetch = fetch): Promise<Response> {
  const user = await syncUser(req, env);
  if (user instanceof Response) return user;
  let body: { cursor?: unknown; limit?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: '400 请求有误：不是 JSON' }, 400);
  }
  const cursor = Number(body.cursor ?? 0);
  const limit = Math.min(Math.max(1, Number(body.limit ?? 500) || 500), MAX_PULL);
  if (!Number.isInteger(cursor) || cursor < 0) return json({ error: '400 请求有误：cursor 要是非负整数' }, 400);
  try {
    await ensureSchema(env, fetcher);
    const [rows] = await execute(
      env,
      [
        {
          sql: `SELECT "tbl", "id", "updated_at", "deleted", "data", "seq" FROM "sync_row" WHERE "user_id" = ? AND "seq" > ? ORDER BY "seq" LIMIT ?`,
          args: [user, cursor, limit + 1],
        },
      ],
      fetcher,
    );
    const page = rows!.slice(0, limit);
    return json({
      rows: page.map((r) => ({
        table: r.tbl,
        id: r.id,
        updated_at: r.updated_at,
        deleted: Number(r.deleted) !== 0,
        seq: Number(r.seq),
        row: JSON.parse(String(r.data)),
      })),
      cursor: page.length ? Number(page.at(-1)!.seq) : cursor,
      more: rows!.length > limit,
    });
  } catch (e) {
    return dbError(e);
  }
}

function dbError(e: unknown): Response {
  if (e instanceof TursoError) return json({ error: e.message }, e.status);
  return json({ error: `500 服务器内部错误：${String(e)}` }, 500);
}
