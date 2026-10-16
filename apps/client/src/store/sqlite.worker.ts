/**
 * Web 端 SQLite 的工作线程：官方 @sqlite.org/sqlite-wasm + opfs-sahpool VFS（OPFS 同步访问句柄）。
 * 单线程、不要 SharedArrayBuffer，所以不需要跨源隔离，Safari 16.4+ 也能用。
 * 同一时刻只能有一个线程拿着这些句柄 → 由主线程的标签页锁（tab-lock.ts）保证只有一个标签页打开。
 * 消息：{ id, op: 'open' | 'exec' | 'run' | 'all' | 'close', sql?, params? } → { id, ok, rows? | error }。
 */
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';

type Db = { exec: (o: unknown) => unknown; close: () => void };
type Pool = { OpfsSAHPoolDb: new (file: string) => Db; pauseVfs: () => unknown };

let db: Db | null = null;
let pool: Pool | null = null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function open(file: string) {
  if (db) return;
  const sqlite3 = await sqlite3InitModule();
  // 刚被别的标签页「在这里用」抢过来时，旧标签页的句柄可能还没放：重试几次
  let lastErr: unknown;
  for (let i = 0; i < 25; i++) {
    try {
      pool = (await sqlite3.installOpfsSAHPoolVfs({ name: 'mindough-sahpool', directory: '.mindough-sahpool' })) as unknown as Pool;
      break;
    } catch (e) {
      lastErr = e;
      await sleep(200);
    }
  }
  if (!pool) throw lastErr;
  db = new pool.OpfsSAHPoolDb(file);
  db.exec({ sql: 'PRAGMA journal_mode = DELETE; PRAGMA foreign_keys = OFF;' });
}

self.onmessage = async (ev: MessageEvent) => {
  const { id, op, sql, params, file } = ev.data as { id: number; op: string; sql?: string; params?: unknown[]; file?: string };
  try {
    let rows: unknown[] | undefined;
    if (op === 'open') await open(file ?? '/mindough.db');
    else if (op === 'close') {
      db?.close();
      db = null;
      pool?.pauseVfs();
    } else {
      if (!db) throw new Error('database not open');
      if (op === 'exec') db.exec({ sql });
      else if (op === 'run') db.exec({ sql, bind: params ?? [] });
      else if (op === 'all') rows = db.exec({ sql, bind: params ?? [], rowMode: 'object', returnValue: 'resultRows' }) as unknown[];
      else throw new Error(`unknown op ${op}`);
    }
    (self as unknown as Worker).postMessage({ id, ok: true, rows });
  } catch (e) {
    (self as unknown as Worker).postMessage({ id, ok: false, error: e instanceof Error ? e.message : String(e) });
  }
};
