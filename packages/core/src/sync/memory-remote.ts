/**
 * 内存里的“云端”：与 Worker（apps/server/src/sync.ts）同样的规则——行级 LWW 接受写入、每次采纳 seq 加一、
 * 按 seq 游标分页拉取。测试里模拟多台设备，也可当作协议的参考实现。
 */
import type { PullResult, PushResult, PulledRow, SyncTransport, WireRow } from './protocol';
import { SyncHttpError } from './protocol';

export class MemoryRemote {
  private rows = new Map<string, PulledRow>();
  private seq = 0;
  /** 置为 true 时所有请求都像断网一样失败。 */
  offline = false;
  pushes = 0;
  pulls = 0;

  push(rows: readonly WireRow[]): PushResult {
    if (this.offline) throw new SyncHttpError(0, '网络不通');
    this.pushes++;
    let applied = 0;
    for (const r of rows) {
      const k = `${r.table}/${r.id}`;
      const cur = this.rows.get(k);
      if (cur && !(r.updated_at > cur.updated_at)) continue;
      this.rows.set(k, { ...JSON.parse(JSON.stringify(r)), seq: ++this.seq });
      applied++;
    }
    return { applied };
  }

  pull(cursor: number, limit: number): PullResult {
    if (this.offline) throw new SyncHttpError(0, '网络不通');
    this.pulls++;
    const all = [...this.rows.values()].filter((r) => r.seq > cursor).sort((a, b) => a.seq - b.seq);
    const rows = all.slice(0, limit).map((r) => JSON.parse(JSON.stringify(r)) as PulledRow);
    return { rows, cursor: rows.at(-1)?.seq ?? cursor, more: all.length > limit };
  }

  get(table: string, id: string): PulledRow | undefined {
    return this.rows.get(`${table}/${id}`);
  }

  get size(): number {
    return this.rows.size;
  }

  /** 一台设备的传输层。 */
  transport(): SyncTransport {
    return {
      push: async (rows) => this.push(rows),
      pull: async (cursor, limit) => this.pull(cursor, limit),
    };
  }
}
