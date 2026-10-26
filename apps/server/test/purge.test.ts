/**
 * 清理没人用的附件文件（Rei 2026-10-25）：推送时即时删、每天定期清理。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handle, scheduled, type Env } from '../src/index';
import { sign } from '../src/session';
import { resetSchemaCache } from '../src/sync';
import { ownerHash } from '../src/files';
import { openDb } from '../src/storage';
import { DAY_MS, FRESH_UPLOAD_MS, fileKeysIn, hlcMs, purgeOrphans, purgeTiming, type PurgeBucket } from '../src/purge';
import type { AssetBucket, R2Object } from '../src/assets';
import { FakeTurso } from './fake-turso';

const ORIGIN = 'https://app.mindough.rei8t.dev';
const REI = 'reiy.leoz@gmail.com';
const OTHER = 'other@example.com';
const NOW = Date.UTC(2026, 9, 25, 19, 0, 0);

class FakeR2 implements AssetBucket, PurgeBucket {
  objects = new Map<string, { buf: ArrayBuffer; uploaded: Date }>();
  deletes: string[][] = [];
  lists = 0;
  add(key: string, uploaded: number, size = 10) {
    this.objects.set(key, { buf: new ArrayBuffer(size), uploaded: new Date(uploaded) });
  }
  async get(key: string): Promise<R2Object | null> {
    const o = this.objects.get(key);
    return o ? { body: new Response(o.buf).body!, size: o.buf.byteLength } : null;
  }
  async head(key: string) {
    const o = this.objects.get(key);
    return o ? { size: o.buf.byteLength, uploaded: o.uploaded } : null;
  }
  async put(key: string, value: ArrayBuffer) {
    this.objects.set(key, { buf: value, uploaded: new Date() });
    return {};
  }
  async list(opts: { prefix: string; cursor?: string; limit?: number }) {
    this.lists++;
    const all = [...this.objects.keys()].filter((k) => k.startsWith(opts.prefix)).sort();
    const start = opts.cursor ? Number(opts.cursor) : 0;
    const limit = opts.limit ?? 1000;
    const page = all.slice(start, start + limit);
    const truncated = start + limit < all.length;
    return {
      objects: page.map((key) => ({ key, size: this.objects.get(key)!.buf.byteLength, uploaded: this.objects.get(key)!.uploaded })),
      truncated,
      cursor: truncated ? String(start + limit) : undefined,
    };
  }
  async delete(keys: string | string[]) {
    const ks = Array.isArray(keys) ? keys : [keys];
    this.deletes.push(ks);
    for (const k of ks) this.objects.delete(k);
  }
}

let turso: FakeTurso;
let env: Env;
let r2: FakeR2;
let pending: Promise<unknown>[];

beforeEach(() => {
  turso = new FakeTurso();
  resetSchemaCache();
  r2 = new FakeR2();
  pending = [];
  env = {
    SESSION_SECRET: 'test-secret-0123456789',
    ALLOWED_EMAILS: `${REI}, ${OTHER}`,
    TURSO_DB_URL: turso.url.replace('https://', 'libsql://'),
    TURSO_DB_TOKEN: turso.token,
    FILES: r2,
  };
  vi.stubGlobal('fetch', turso.fetch);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  purgeTiming.undoWaitMs = 0;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const sha = (n: number) => n.toString(16).padStart(64, '0');
const keyOf = async (who: string, n: number) => `${await ownerHash(who)}/f/${sha(n)}`;
const hlc = (ms: number, c = 0) => `${String(ms).padStart(13, '0')}-${c.toString(16).padStart(4, '0')}-devA`;
const OLD = NOW - 40 * DAY_MS;

async function token(who = REI) {
  return sign({ k: 'sync', email: who, exp: Date.now() + 60_000 }, env.SESSION_SECRET!);
}
async function push(rows: unknown[], who = REI) {
  const res = await handle(
    new Request(`${ORIGIN}/api/sync/push`, { method: 'POST', headers: { authorization: `Bearer ${await token(who)}` }, body: JSON.stringify({ rows }) }),
    env,
    (p) => pending.push(p),
  );
  await Promise.all(pending);
  pending = [];
  return res;
}
const att = (id: string, r2_key: string | null, thumb_key: string | null, updated_at: string, deleted = false) => ({
  table: 'attachment',
  id,
  updated_at,
  deleted,
  row: { id, owner_type: 'task', owner_id: 't1', file_name: 'a.png', mime: 'image/png', size: 10, r2_key, thumb_key, width: 1, height: 1, created_at: '2026-10-01T00:00:00Z', updated_at, deleted },
});
const task = (id: string, body_md: string, updated_at: string, deleted = false) => ({ table: 'task', id, updated_at, deleted, row: { id, body_md, updated_at, deleted } });

describe('小工具', () => {
  it('fileKeysIn 只认这个哈希的附件 key；资料图（没有 /f/）不算', async () => {
    const h = await ownerHash(REI);
    const mine = `${h}/f/${sha(1)}`;
    const theirs = `${await ownerHash(OTHER)}/f/${sha(2)}`;
    const text = JSON.stringify({ r2_key: mine, body: `![](/api/files/${mine}) ![](/api/files/${theirs}) ![](/api/assets/${h}/${sha(3)})` });
    expect(fileKeysIn(text, h)).toEqual([mine]);
  });
  it('hlcMs：HLC 取毫秒，ISO 也认，看不懂 null', () => {
    expect(hlcMs(hlc(123456))).toBe(123456);
    expect(hlcMs('2026-10-25T00:00:00Z')).toBe(Date.UTC(2026, 9, 25));
    expect(hlcMs('什么')).toBeNull();
  });
});

describe('推送时即时删', () => {
  it('附件删了、没别的行引用：原文件和缩略图都删', async () => {
    const k = await keyOf(REI, 1);
    const t = await keyOf(REI, 2);
    r2.add(k, OLD, 100);
    r2.add(t, OLD, 7);
    await push([att('a1', k, t, hlc(1000))]);
    expect(r2.objects.size).toBe(2);
    const res = await push([att('a1', k, t, hlc(2000), true)]);
    expect(res.status).toBe(200);
    expect(r2.objects.has(k)).toBe(false);
    expect(r2.objects.has(t)).toBe(false);
  });

  it('别的附件还用着同一个文件：不删（缩略图只有它用就删）', async () => {
    const k = await keyOf(REI, 1);
    const t = await keyOf(REI, 2);
    r2.add(k, OLD);
    r2.add(t, OLD);
    await push([att('a1', k, t, hlc(1000)), att('a2', k, null, hlc(1000))]);
    await push([att('a1', k, t, hlc(2000), true)]);
    expect(r2.objects.has(k)).toBe(true);
    expect(r2.objects.has(t)).toBe(false);
  });

  it('同一批里新加的附件用着同一份内容：先写完整批再判断，不删', async () => {
    const k = await keyOf(REI, 1);
    r2.add(k, OLD);
    await push([att('a1', k, null, hlc(1000))]);
    await push([att('a1', k, null, hlc(2000), true), att('a3', k, null, hlc(2000))]);
    expect(r2.objects.has(k)).toBe(true);
  });

  it('任务正文里写着 /api/files/<key>：算引用，不删', async () => {
    const k = await keyOf(REI, 1);
    r2.add(k, OLD);
    await push([att('a1', k, null, hlc(1000)), task('t1', `看图 ![](/api/files/${k})`, hlc(1000))]);
    await push([att('a1', k, null, hlc(2000), true)]);
    expect(r2.objects.has(k)).toBe(true);
  });

  it('只看自己的行、只删自己的文件：别人的墓碑里写着我的 key 也不删；我的引用也护不住别人', async () => {
    const mine = await keyOf(REI, 1);
    const theirs = await keyOf(OTHER, 1);
    r2.add(mine, OLD);
    r2.add(theirs, OLD);
    // 别人的墓碑里写着我的 key：不是他的哈希，不碰
    await push([att('x', mine, null, hlc(2000), true)], OTHER);
    expect(r2.objects.has(mine)).toBe(true);
    // 我这边有行引用 theirs 的字面值，不影响别人删自己的
    await push([task('t1', theirs, hlc(1000))]);
    await push([att('y', theirs, null, hlc(2000), true)], OTHER);
    expect(r2.objects.has(theirs)).toBe(false);
  });

  it('文件刚传上来不满 15 分钟：先不删，交给定期清理', async () => {
    const k = await keyOf(REI, 1);
    r2.add(k, Date.now() - FRESH_UPLOAD_MS / 2);
    await push([att('a1', k, null, hlc(2000), true)]);
    expect(r2.objects.has(k)).toBe(true);
  });

  it('先等一会儿再判断：等的这段时间里撤销（行恢复）推上来了就不删', async () => {
    const k = await keyOf(REI, 1);
    r2.add(k, OLD);
    purgeTiming.undoWaitMs = 30;
    const tok = await token();
    const call = (rows: unknown[]) =>
      handle(new Request(`${ORIGIN}/api/sync/push`, { method: 'POST', headers: { authorization: `Bearer ${tok}` }, body: JSON.stringify({ rows }) }), env, (p) => pending.push(p));
    await call([att('a1', k, null, hlc(2000), true)]);
    await call([att('a1', k, null, hlc(3000))]);
    await Promise.all(pending);
    expect(r2.objects.has(k)).toBe(true);
  });

  it('墓碑没写进库（旧的 updated_at 输了 LWW）：不触发', async () => {
    const k = await keyOf(REI, 1);
    r2.add(k, OLD);
    await push([att('a1', k, null, hlc(5000))]);
    await push([att('a1', k, null, hlc(2000), true)]);
    expect(r2.objects.has(k)).toBe(true);
  });

  it('删 R2 出错不影响同步响应', async () => {
    const k = await keyOf(REI, 1);
    r2.add(k, OLD);
    r2.delete = async () => {
      throw new Error('R2 坏了');
    };
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await push([att('a1', k, null, hlc(2000), true)]);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ applied: 1 });
  });
});

describe('每天定期清理', () => {
  const db = () => openDb(env);

  it('30 天边界：墓碑满 30 天删，差一点留；从没被引用的按上传时间算；有引用的不删；资料图不动', async () => {
    const h = await ownerHash(REI);
    const del31 = await keyOf(REI, 1);
    const del29 = await keyOf(REI, 2);
    const orphanOld = await keyOf(REI, 3);
    const orphanNew = await keyOf(REI, 4);
    const live = await keyOf(REI, 5);
    const asset = `${h}/${sha(6)}`;
    for (const k of [del31, del29, orphanOld, orphanNew, live, asset]) r2.add(k, OLD, 50);
    r2.add(orphanNew, NOW - 29 * DAY_MS, 50);
    r2.add(orphanOld, NOW - 30 * DAY_MS, 50);
    // 先建好行（文件旧，即时删也会删掉，所以先建活的再打墓碑时关掉 R2 删除）
    await push([
      att('d31', del31, null, hlc(NOW - 30 * DAY_MS), true),
      att('d29', del29, null, hlc(NOW - 29 * DAY_MS), true),
      att('l', live, null, hlc(NOW - 100 * DAY_MS)),
      att('l-old', live, null, hlc(NOW - 90 * DAY_MS), true),
    ]);
    // 上面那次推送的即时删会删掉 del31 / del29（没人引用、文件旧）。这里只测定期清理，放回去
    for (const k of [del31, del29]) r2.add(k, OLD, 50);
    const rep = await purgeOrphans(db(), r2, NOW);
    expect(rep.keys.sort()).toEqual([del31, orphanOld].sort());
    expect(rep.deleted).toBe(2);
    expect(rep.bytes).toBe(100);
    expect(r2.objects.has(del29)).toBe(true);
    expect(r2.objects.has(orphanNew)).toBe(true);
    expect(r2.objects.has(live)).toBe(true);
    expect(r2.objects.has(asset)).toBe(true);
  });

  it('只要还有一行删了不满 30 天就留着（按最晚的墓碑算）', async () => {
    const k = await keyOf(REI, 1);
    await push([att('a', k, null, hlc(NOW - 60 * DAY_MS), true), att('b', k, null, hlc(NOW - 10 * DAY_MS), true)]);
    r2.add(k, OLD);
    const rep = await purgeOrphans(db(), r2, NOW);
    expect(rep.deleted).toBe(0);
    expect(r2.objects.has(k)).toBe(true);
  });

  it('跨用户：各扫各的前缀，我的行护不住别人的孤儿，别人哈希下的文件按别人的行判断', async () => {
    const mine = await keyOf(REI, 1);
    const theirs = await keyOf(OTHER, 1);
    await push([task('t', `${mine} ${theirs}`, hlc(NOW))]);
    await push([task('t', 'x', hlc(NOW))], OTHER);
    r2.add(mine, OLD);
    r2.add(theirs, OLD);
    const rep = await purgeOrphans(db(), r2, NOW);
    expect(rep.users).toBe(2);
    expect(rep.keys).toEqual([theirs]);
    expect(r2.objects.has(mine)).toBe(true);
  });

  it('没有同步行的哈希前缀不碰', async () => {
    const stranger = `${'f'.repeat(16)}/f/${sha(9)}`;
    r2.add(stranger, OLD);
    await push([task('t', 'x', hlc(NOW))]);
    await purgeOrphans(db(), r2, NOW);
    expect(r2.objects.has(stranger)).toBe(true);
  });

  it('分页：文件和行都分好几页也全扫到；单次删除有上限，标 partial', async () => {
    const keys = await Promise.all(Array.from({ length: 7 }, (_, i) => keyOf(REI, 100 + i)));
    for (const k of keys) r2.add(k, OLD);
    // 前 3 个有活引用，分散在多页行里
    await push([
      task('t0', 'x', hlc(NOW)),
      ...keys.slice(0, 3).map((k, i) => att(`live${i}`, k, null, hlc(NOW + i))),
      task('t9', `/f/ 但不是 key`, hlc(NOW)),
    ]);
    const limits = { listPage: 2, maxListPages: 20, maxDeletes: 3, rowPage: 2 };
    const r1 = await purgeOrphans(db(), r2, NOW, limits);
    expect(r1.scanned).toBe(7);
    expect(r1.deleted).toBe(3);
    expect(r1.partial).toBe(true);
    const r2nd = await purgeOrphans(db(), r2, NOW, limits);
    expect(r2nd.deleted).toBe(1);
    expect(r2nd.partial).toBe(false);
    for (const k of keys.slice(0, 3)) expect(r2.objects.has(k)).toBe(true);
    for (const k of keys.slice(3)) expect(r2.objects.has(k)).toBe(false);
  });

  it('列文件页数到上限：只处理列到的，标 partial', async () => {
    const keys = await Promise.all(Array.from({ length: 5 }, (_, i) => keyOf(REI, 200 + i)));
    for (const k of keys) r2.add(k, OLD);
    await push([task('t', 'x', hlc(NOW))]);
    const rep = await purgeOrphans(db(), r2, NOW, { listPage: 2, maxListPages: 1, maxDeletes: 100, rowPage: 50 });
    expect(rep.scanned).toBe(2);
    expect(rep.deleted).toBe(2);
    expect(rep.partial).toBe(true);
  });

  it('scheduled()：没配 R2 就跳过', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await scheduled({ ...env, FILES: undefined }, NOW)).toBeUndefined();
    const k = await keyOf(REI, 1);
    await push([task('t', 'x', hlc(NOW))]);
    r2.add(k, OLD);
    const rep = await scheduled(env, NOW);
    expect(rep?.deleted).toBe(1);
  });
});

describe('HEAD /api/files/<key>', () => {
  it('在：200 无正文；清掉了：404 未找到；别人的：404', async () => {
    const k = await keyOf(REI, 1);
    r2.add(k, OLD, 33);
    const auth = { authorization: `Bearer ${await sign({ sub: 's', email: REI, name: 'Rei', picture: null, exp: Date.now() + 60_000 }, env.SESSION_SECRET!)}` };
    const a = await handle(new Request(`${ORIGIN}/api/files/${k}`, { method: 'HEAD', headers: auth }), env);
    expect(a.status).toBe(200);
    expect(a.headers.get('content-length')).toBe('33');
    expect(a.headers.get('cache-control')).toBe('no-store');
    expect(await a.text()).toBe('');
    const gone = await keyOf(REI, 2);
    expect((await handle(new Request(`${ORIGIN}/api/files/${gone}`, { method: 'HEAD', headers: auth }), env)).status).toBe(404);
    const theirs = await keyOf(OTHER, 1);
    r2.add(theirs, OLD);
    expect((await handle(new Request(`${ORIGIN}/api/files/${theirs}`, { method: 'HEAD', headers: auth }), env)).status).toBe(404);
  });
});
