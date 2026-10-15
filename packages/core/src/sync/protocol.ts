/**
 * 同步协议（客户端 ↔ Worker `/api/sync/*`，Worker ↔ Turso Cloud）。
 *
 * 云端只存“行”：每行 = (表, id, updated_at, deleted, 整行 JSON, seq)。seq 是云端每接受一次写入就加一的序号，
 * 客户端记住拉到的最大 seq（游标），下次只拉更大的。云端按行级 LWW 接受写入：updated_at（HLC）更大才覆盖。
 * 云端不关心业务列，客户端加列 / 加表（本地迁移）不用动云端 schema。
 */
import type { BaseRow, TableName } from '../types';

export interface WireRow {
  table: TableName;
  id: string;
  updated_at: string;
  deleted: boolean;
  /** 整行（含 id / updated_at / deleted）。 */
  row: BaseRow;
}

export interface PulledRow extends WireRow {
  seq: number;
}

export interface PushResult {
  /** 云端实际采纳（比已有的新）的行数。 */
  applied: number;
}

export interface PullResult {
  rows: PulledRow[];
  /** 本页最后一行的 seq；没有新行时等于请求的游标。 */
  cursor: number;
  more: boolean;
}

/** 同步凭据（POST /api/sync/token）。 */
export interface SyncToken {
  /** 同步接口的基址，如 https://mindough.rei8t.dev/api/sync */
  url: string;
  token: string;
  /** ISO 时间；过期前客户端重新取。 */
  expires_at?: string;
}

/** 传输层：HTTP（apps/client/src/lib/sync.ts）或测试里的假云端。 */
export interface SyncTransport {
  push(rows: readonly WireRow[]): Promise<PushResult>;
  pull(cursor: number, limit: number): Promise<PullResult>;
}

/** 传输层抛出的错误：带 HTTP 状态码（0 = 网络不通）。 */
export class SyncHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'SyncHttpError';
  }
  get offline(): boolean {
    return this.status === 0;
  }
}

export const PUSH_BATCH = 200;
export const PULL_PAGE = 500;
