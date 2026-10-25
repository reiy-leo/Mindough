/**
 * 清理没人用的附件文件（Rei 2026-10-25：「不能立即判断是否还有引用么，没引用直接删？」「同时加一个定期清理：没人引用且删满 30 天的文件从云端删掉」）。
 *
 * 只管附件（key = <用户哈希>/f/<sha256>，原文件和缩略图都是这个形状）。资料图、正文图片（/api/assets，key 没有 /f/）不动。
 *
 * 「引用」= 这个用户 sync_row 里任何一行（不分表）的整行 JSON 里出现了这个 key：附件行的 r2_key / thumb_key，
 * 也包括任务正文、日记正文、备注里写着的 /api/files/<key> 链接。只看自己的行，只删自己哈希前缀下的文件。
 *
 * 1. 即时删（afterPush）：同步推送写库之后，从这次变成墓碑的行里取出 key；整批行都已经写进库再判断，
 *    同一批里新加的附件用着同一份内容就不会删。先等 12 秒（删除提示里的「撤销」6 秒 + 同步防抖 1.5 秒，撤销推上来就不删），
 *    没人引用、文件上传满 15 分钟，删前再查一次引用，再删 R2。
 *    放进 ctx.waitUntil（响应之后最多 30 秒），不拖慢同步响应；出错只记日志，交给定期清理兜底。
 * 2. 定期清理（purgeOrphans，cron 每天 UTC 19:00 = 北京 03:00）：逐个用户列出 R2 `<哈希>/f/` 下的文件：
 *    - 有没删的行引用 → 留着；
 *    - 只有删掉的行引用 → 这些行全部删满 30 天（按墓碑 updated_at 的时间）才删；
 *    - 从没被任何行引用 → 上传满 30 天才删（防止刚传上去、行还没同步过来的文件误删）。
 *    删前再查一次引用。分页列，单次有上限；日志记删了几个、多少字节。
 */
import type { SqlDb } from './sql';
import { ownerHash } from './files';
import { ensureSchema } from './sync';

/** R2 里清理要用到的那几个方法（Workers 的 R2Bucket 都有）。 */
export interface PurgeBucket {
  head(key: string): Promise<{ size: number; uploaded: Date } | null>;
  list(opts: { prefix: string; cursor?: string; limit?: number }): Promise<{ objects: Array<{ key: string; size: number; uploaded: Date }>; truncated: boolean; cursor?: string }>;
  delete(keys: string | string[]): Promise<void>;
}

export const DAY_MS = 24 * 3600_000;
/** 删了 / 没人引用多久才删（定期清理）。 */
export const PURGE_AFTER_MS = 30 * DAY_MS;
/** 即时删先等这么久再判断：让「撤销」有机会推上来（提示 6 秒 + 同步防抖 1.5 秒 + 网络）。测试里改成 0。 */
export const purgeTiming = { undoWaitMs: 12_000 };
/** 即时删时，文件上传不满这么久先不删（别的设备可能刚传了同一份内容、行还没推上来）；留给定期清理。 */
export const FRESH_UPLOAD_MS = 15 * 60_000;

export interface PurgeLimits {
  /** 每页列多少个 R2 文件。 */
  listPage: number;
  /** 每个用户最多列几页。 */
  maxListPages: number;
  /** 一次运行最多删几个文件。 */
  maxDeletes: number;
  /** 扫行时每页几行。 */
  rowPage: number;
}
export const DEFAULT_LIMITS: PurgeLimits = { listPage: 1000, maxListPages: 20, maxDeletes: 500, rowPage: 500 };

const KEY_RE = /([0-9a-f]{16})\/f\/([0-9a-f]{64})/g;

/** 文字里出现的、属于这个哈希的附件 key（去重）。 */
export function fileKeysIn(text: string, hash: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(KEY_RE)) if (m[1] === hash) out.add(m[0]);
  return [...out];
}

/** HLC（<13 位毫秒>-<计数>-<设备>）或 ISO 时间 → 毫秒；看不懂返回 null。 */
export function hlcMs(updatedAt: string): number | null {
  const m = /^(\d{13})-/.exec(updatedAt);
  if (m) return Number(m[1]);
  const t = Date.parse(updatedAt);
  return Number.isFinite(t) ? t : null;
}

const CHUNK = 40;

/** 这些 key 里，哪些还有没删的行引用（同一个用户）。一条 SQL 查一批。 */
export async function referencedKeys(db: SqlDb, user: string, keys: readonly string[]): Promise<Set<string>> {
  const live = new Set<string>();
  for (let i = 0; i < keys.length; i += CHUNK) {
    const part = keys.slice(i, i + CHUNK);
    const cond = part.map(() => `instr("data", ?) > 0`).join(' OR ');
    const [rows] = await db.execute([{ sql: `SELECT "data" FROM "sync_row" WHERE "user_id" = ? AND "deleted" = 0 AND (${cond})`, args: [user, ...part] }]);
    for (const r of rows ?? []) {
      const data = String(r.data);
      for (const k of part) if (data.includes(k)) live.add(k);
    }
  }
  return live;
}

export interface PurgeResult {
  deleted: number;
  bytes: number;
  keys: string[];
}

/**
 * 即时删：rows 是这次推送里真写进库、而且是墓碑的行（整行 JSON）。调用时整批已经写进库。
 * 出错不抛（返回已删的），由定期清理兜底。
 */
export async function purgeAfterPush(db: SqlDb, files: PurgeBucket | undefined, user: string, tombstones: readonly string[], now?: number): Promise<PurgeResult> {
  const out: PurgeResult = { deleted: 0, bytes: 0, keys: [] };
  if (!files || !tombstones.length) return out;
  try {
    if (purgeTiming.undoWaitMs > 0) await new Promise((r) => setTimeout(r, purgeTiming.undoWaitMs));
    const hash = await ownerHash(user);
    const candidates = [...new Set(tombstones.flatMap((d) => fileKeysIn(d, hash)))];
    if (!candidates.length) return out;
    const live = await referencedKeys(db, user, candidates);
    const maybe: Array<{ key: string; size: number }> = [];
    for (const k of candidates) {
      if (live.has(k)) continue;
      const obj = await files.head(k);
      if (!obj) continue;
      if ((now ?? Date.now()) - new Date(obj.uploaded).getTime() < FRESH_UPLOAD_MS) continue;
      maybe.push({ key: k, size: obj.size });
    }
    if (!maybe.length) return out;
    // 删之前再查一次：这期间别的设备可能推上来了引用它的行
    const again = await referencedKeys(db, user, maybe.map((x) => x.key));
    const gone = maybe.filter((x) => !again.has(x.key));
    if (!gone.length) return out;
    await files.delete(gone.map((x) => x.key));
    out.deleted = gone.length;
    out.bytes = gone.reduce((s, x) => s + x.size, 0);
    out.keys = gone.map((x) => x.key);
    console.log(JSON.stringify({ msg: '附件即时清理', deleted: out.deleted, bytes: out.bytes }));
  } catch (e) {
    console.warn(JSON.stringify({ msg: '附件即时清理失败，交给定期清理', error: String(e) }));
  }
  return out;
}

export interface OrphanReport extends PurgeResult {
  users: number;
  scanned: number;
  /** 碰到上限没扫完。 */
  partial: boolean;
}

/** 一个用户的行里，附件 key 的引用情况：live = 有没删的行引用；deletedAt = 只看删掉的行时最晚的墓碑时间。 */
async function refsOf(db: SqlDb, user: string, hash: string, limits: PurgeLimits): Promise<{ live: Set<string>; deletedAt: Map<string, number> }> {
  const live = new Set<string>();
  const deletedAt = new Map<string, number>();
  let cursor = 0;
  for (;;) {
    const [rows] = await db.execute([
      {
        sql: `SELECT "updated_at", "deleted", "data", "seq" FROM "sync_row" WHERE "user_id" = ? AND "seq" > ? AND instr("data", '/f/') > 0 ORDER BY "seq" LIMIT ?`,
        args: [user, cursor, limits.rowPage],
      },
    ]);
    const page = rows ?? [];
    for (const r of page) {
      const keys = fileKeysIn(String(r.data), hash);
      if (!keys.length) continue;
      if (Number(r.deleted) === 0) for (const k of keys) live.add(k);
      else {
        // 墓碑时间看不懂当成刚删的（宁可多留）
        const t = hlcMs(String(r.updated_at)) ?? Number.MAX_SAFE_INTEGER;
        for (const k of keys) deletedAt.set(k, Math.max(deletedAt.get(k) ?? 0, t));
      }
    }
    if (page.length < limits.rowPage) break;
    cursor = Number(page.at(-1)!.seq);
  }
  return { live, deletedAt };
}

/** 定期清理（cron）。 */
export async function purgeOrphans(db: SqlDb, files: PurgeBucket, now = Date.now(), limits: PurgeLimits = DEFAULT_LIMITS): Promise<OrphanReport> {
  await ensureSchema(db);
  const report: OrphanReport = { deleted: 0, bytes: 0, keys: [], users: 0, scanned: 0, partial: false };
  const [users] = await db.execute([{ sql: `SELECT DISTINCT "user_id" FROM "sync_row"` }]);
  for (const u of users ?? []) {
    if (report.deleted >= limits.maxDeletes) {
      report.partial = true;
      break;
    }
    const user = String(u.user_id);
    const hash = await ownerHash(user);
    report.users++;
    // 先列文件：列完再看行，行里新出现的引用只会让我们少删，不会多删
    const objects: Array<{ key: string; size: number; uploaded: Date }> = [];
    let cursor: string | undefined;
    for (let page = 0; ; page++) {
      if (page >= limits.maxListPages) {
        report.partial = true;
        break;
      }
      const res = await files.list({ prefix: `${hash}/f/`, cursor, limit: limits.listPage });
      objects.push(...res.objects);
      if (!res.truncated || !res.cursor) break;
      cursor = res.cursor;
    }
    report.scanned += objects.length;
    if (!objects.length) continue;
    const { live, deletedAt } = await refsOf(db, user, hash, limits);
    const doomed: Array<{ key: string; size: number }> = [];
    for (const o of objects) {
      if (live.has(o.key)) continue;
      const del = deletedAt.get(o.key);
      const since = del !== undefined ? del : new Date(o.uploaded).getTime();
      if (now - since < PURGE_AFTER_MS) continue;
      doomed.push({ key: o.key, size: o.size });
    }
    const room = limits.maxDeletes - report.deleted;
    if (doomed.length > room) report.partial = true;
    const batch = doomed.slice(0, room);
    if (!batch.length) continue;
    const again = await referencedKeys(db, user, batch.map((x) => x.key));
    const gone = batch.filter((x) => !again.has(x.key));
    for (let i = 0; i < gone.length; i += 1000) await files.delete(gone.slice(i, i + 1000).map((x) => x.key));
    report.deleted += gone.length;
    report.bytes += gone.reduce((s, x) => s + x.size, 0);
    report.keys.push(...gone.map((x) => x.key));
  }
  console.log(JSON.stringify({ msg: '附件定期清理', users: report.users, scanned: report.scanned, deleted: report.deleted, bytes: report.bytes, partial: report.partial }));
  return report;
}
