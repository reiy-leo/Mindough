/**
 * 端到端：两台模拟设备（core 的 Store + SyncEngine）经 Worker 的真实处理函数（本地跑 handle()）同步到真实的 Turso 数据库。
 * 平时跳过；手动跑：
 *   E2E_TURSO_URL=https://mindough-rei8.aws-ap-northeast-1.turso.io E2E_TURSO_TOKEN_FILE=/path/to/token \
 *     npx vitest run e2e/real-turso.test.ts
 * 用一个测试专用账户（e2e@mindough.test），跑完删掉它的行。数据库凭据只从文件读，不打印。
 */
import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { handle, type Env } from '../src/index';
import { sign } from '../src/session';
import { execute } from '../src/turso';
import { MemoryAdapter, Store, SyncEngine, SyncHttpError, type SyncTransport } from '../../../packages/core/src/index';

const url = process.env.E2E_TURSO_URL;
const tokenFile = process.env.E2E_TURSO_TOKEN_FILE;
const EMAIL = 'e2e@mindough.test';

describe.skipIf(!url || !tokenFile)('真实 Turso：两台设备同步一件任务', () => {
  const env: Env = {
    SESSION_SECRET: 'e2e-local-secret-' + Math.random(),
    ALLOWED_EMAILS: EMAIL,
    TURSO_DB_URL: url,
    TURSO_DB_TOKEN: tokenFile ? readFileSync(tokenFile, 'utf8').trim() : '',
  };
  const ORIGIN = 'https://app.mindough.rei8t.dev';

  async function transport(): Promise<SyncTransport> {
    const session = await sign({ sub: 'e2e', email: EMAIL, name: 'E2E', picture: null, exp: Date.now() + 600_000 }, env.SESSION_SECRET!);
    const t = await handle(new Request(`${ORIGIN}/api/sync/token`, { method: 'POST', headers: { authorization: `Bearer ${session}` } }), env);
    expect(t.status).toBe(200);
    const { token } = (await t.json()) as { token: string };
    const call = async (path: string, body: unknown) => {
      const res = await handle(new Request(`${ORIGIN}/api/sync/${path}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }), env);
      const data = (await res.json()) as any;
      if (!res.ok) throw new SyncHttpError(res.status, data.error);
      return data;
    };
    return { push: (rows) => call('push', { rows }), pull: (cursor, limit) => call('pull', { cursor, limit }) };
  }

  afterAll(async () => {
    const [left] = await execute(env, [{ sql: `DELETE FROM "sync_row" WHERE "user_id" = ? RETURNING "id"`, args: [EMAIL] }]);
    console.log(`清理：删掉测试账户的 ${left!.length} 行`);
  });

  it('A 新建 → B 拉到 → B 改 → A 拉到；旧写入不覆盖新的', async () => {
    const A = await Store.open(new MemoryAdapter(), { deviceId: 'e2eA' });
    const B = await Store.open(new MemoryAdapter(), { deviceId: 'e2eB' });
    const ea = new SyncEngine(A, await transport(), { account: EMAIL });
    const eb = new SyncEngine(B, await transport(), { account: EMAIL });

    const task = A.createTask({ body_md: '端到端：从 A 来' });
    await ea.syncNow();
    expect(ea.snapshot.phase).toBe('idle');
    await eb.syncNow();
    expect(eb.snapshot.phase).toBe('idle');
    expect(B.get('task', task.id)?.body_md).toBe('端到端：从 A 来');

    await new Promise((r) => setTimeout(r, 5));
    B.updateTask(task.id, { body_md: '端到端：B 改过' });
    await eb.syncNow();
    await ea.syncNow();
    expect(A.get('task', task.id)?.body_md).toBe('端到端：B 改过');

    // 一条比云端旧的写入推不上去
    const stale = { ...A.raw('task', task.id)!, body_md: '旧的', updated_at: '0000000000001-0000-old' };
    const tr = await transport();
    expect(await tr.push([{ table: 'task', id: task.id, updated_at: stale.updated_at, deleted: false, row: stale }])).toEqual({ applied: 0 });

    // 打卡两边各一次
    const water = A.createTask({ body_md: '端到端：喝水', completion_mode: 'count', target_value: 8, unit: '杯', recurrence: 'FREQ=DAILY' });
    await ea.syncNow();
    await eb.syncNow();
    A.checkIn(water.id, 'add', 2);
    B.checkIn(water.id, 'add', 3);
    await ea.syncNow();
    await eb.syncNow();
    await ea.syncNow();
    expect(A.progress(water.id)?.value).toBe(5);
    expect(B.progress(water.id)?.value).toBe(5);
  }, 60_000);
});
