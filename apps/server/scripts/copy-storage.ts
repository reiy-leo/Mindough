/// <reference types="node" />
/**
 * 云端库全量复制：Turso ⇄ Cloudflare D1（Rei 2026-10-17）。切换 STORAGE_BACKEND 之前跑；源库只读不删。
 *
 *   pnpm --filter server storage:copy -- --from turso --to d1 [--dry-run] [--replace]
 *   pnpm --filter server storage:copy -- --from d1 --to turso
 *
 * 环境变量：
 *   TURSO_DB_URL            默认 https://mindough-rei8.aws-ap-northeast-1.turso.io
 *   TURSO_DB_TOKEN          或 TURSO_DB_TOKEN_FILE（放数据库 token 的文件）
 *   CLOUDFLARE_ACCOUNT_ID   CLOUDFLARE_API_TOKEN（要有 D1 编辑权限）
 *   D1_DATABASE_ID          默认读 wrangler.deploy.jsonc 里 binding = DB 的 database_id
 *
 * 退出码：0 复制并核对通过（或 --dry-run 统计完）；1 失败 / 核对不通过（这时不要切换）。
 * 步骤、核对项与切换方法见 docs/PLAN.md「云端存储：Turso / D1」。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyStorage } from '../src/copy';
import { d1RestDb } from '../src/d1';
import type { SqlDb, StorageBackend } from '../src/sql';
import { tursoDb } from '../src/turso';

const DEFAULT_TURSO_URL = 'https://mindough-rei8.aws-ap-northeast-1.turso.io';
const here = dirname(fileURLToPath(import.meta.url));

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

function d1IdFromConfig(): string | undefined {
  const text = readFileSync(join(here, '..', 'wrangler.deploy.jsonc'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  const m = text.match(/"binding"\s*:\s*"DB"[^}]*"database_id"\s*:\s*"([^"]+)"/);
  return m?.[1];
}

function open(kind: StorageBackend): SqlDb {
  if (kind === 'turso') {
    const token = process.env.TURSO_DB_TOKEN ?? (process.env.TURSO_DB_TOKEN_FILE ? readFileSync(process.env.TURSO_DB_TOKEN_FILE, 'utf8').trim() : undefined);
    if (!token) throw new Error('缺少 TURSO_DB_TOKEN 或 TURSO_DB_TOKEN_FILE');
    return tursoDb({ TURSO_DB_URL: process.env.TURSO_DB_URL ?? DEFAULT_TURSO_URL, TURSO_DB_TOKEN: token });
  }
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  const databaseId = process.env.D1_DATABASE_ID ?? d1IdFromConfig();
  if (!accountId || !apiToken || !databaseId) throw new Error('缺少 CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN / D1_DATABASE_ID');
  return d1RestDb({ accountId, apiToken, databaseId });
}

const parse = (v: string | undefined): StorageBackend | null => (v === 'turso' || v === 'd1' ? v : null);

async function main() {
  const from = parse(arg('from'));
  const to = parse(arg('to'));
  if (!from || !to || from === to) {
    console.error('用法：storage:copy -- --from turso|d1 --to d1|turso [--dry-run] [--replace]（源和目标要不同）');
    process.exit(1);
  }
  const report = await copyStorage(open(from), open(to), { dryRun: flag('dry-run'), replace: flag('replace'), log: (m) => console.log(m) });
  console.log(JSON.stringify(report, null, 2));
  if (!report.dryRun) console.log(`\n复制完成。要切到 ${to}：把 Worker 的 STORAGE_BACKEND 设成 ${to} 再部署（见 docs/PLAN.md）。${from} 里的数据还在，没有删。`);
}

main().catch((e) => {
  console.error(`失败：${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
