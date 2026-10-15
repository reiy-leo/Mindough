/**
 * SQLite schema：与 types.ts 的数据模型一一对应（每列一个字段），原生端（tauri-plugin-sql）、
 * Web 端（Turso database-wasm / OPFS）与测试（node:sqlite）共用。
 *
 * - 每张表：id TEXT 主键（UUIDv7）、updated_at TEXT（HLC）、deleted INTEGER（墓碑）+ 业务列。
 * - JSON 列存 JSON 文本；布尔存 0/1。
 * - outbox：待推送变更（seq 自增，ack 后删除）；meta：device_id、同步游标等。
 * - schema_version：已应用的迁移版本。只追加迁移，不改已发布的迁移。
 *
 * COLUMNS 的类型约束保证“每个字段都有列”：types.ts 加字段而这里没加，会编译失败；
 * 再由测试比对迁移后的实际列（PRAGMA table_info）与 COLUMNS 一致。
 */
import type { BaseRow, TableMap, TableName } from '../types';

export type ColType = 'text' | 'text?' | 'int' | 'int?' | 'real' | 'real?' | 'bool' | 'json';

type Columns<T extends BaseRow> = { [K in Exclude<keyof T, keyof BaseRow>]-?: ColType };

export const COLUMNS: { [K in TableName]: Columns<TableMap[K]> } = {
  task: {
    body_md: 'text',
    status: 'text',
    group_id: 'text?',
    scheduled_date: 'text?',
    type_id: 'text?',
    type_data: 'json',
    completion_mode: 'text',
    target_value: 'real?',
    unit: 'text?',
    target_date: 'text?',
    recurrence: 'text?',
    checkin_category_id: 'text?',
    done_at: 'text?',
    sort: 'real',
    created_at: 'text',
  },
  dependency: { pred_id: 'text', succ_id: 'text', type: 'text', lag: 'int' },
  group: { name: 'text', icon: 'text', start_at: 'text?', end_at: 'text?', category_id: 'text?', default_type_id: 'text?' },
  category: { name: 'text', color: 'text' },
  task_type: {
    name: 'text',
    icon: 'text',
    color: 'text',
    layout: 'text',
    fields: 'json',
    body_template: 'text',
    builtin: 'bool',
    hidden: 'bool',
    default_completion_mode: 'text',
    sort: 'real',
  },
  person: { name: 'text', avatar_asset_id: 'text?', relation: 'text?', birthday: 'text?', note_md: 'text' },
  task_person: { task_id: 'text', person_id: 'text' },
  my_day: { task_id: 'text', date: 'text', sort: 'real', added_at: 'text' },
  check_in: { task_id: 'text', period_key: 'text', kind: 'text', amount: 'real', at: 'text' },
  checkin_category: { name: 'text', icon: 'text', color: 'text', builtin: 'bool', hidden: 'bool', sort: 'real' },
  asset: { sha256: 'text', mime: 'text', width: 'int?', height: 'int?', r2_key: 'text?', url: 'text?' },
};

/** SQL 标识符加引号（"group" 是关键字）。 */
export const q = (name: string) => `"${name}"`;

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

/**
 * 迁移列表（只追加）。v1 = M1 初始 schema，对应 M0 的数据模型 + 打卡分类。
 * 以后加列：新迁移里 ALTER TABLE … ADD COLUMN，并同步改 COLUMNS。
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: '初始 schema（M1）',
    sql: `
CREATE TABLE IF NOT EXISTS "task" (
  "id" TEXT PRIMARY KEY NOT NULL, "updated_at" TEXT NOT NULL, "deleted" INTEGER NOT NULL DEFAULT 0,
  "body_md" TEXT NOT NULL DEFAULT '', "status" TEXT NOT NULL DEFAULT '待办', "group_id" TEXT, "scheduled_date" TEXT,
  "type_id" TEXT, "type_data" TEXT NOT NULL DEFAULT '{}', "completion_mode" TEXT NOT NULL DEFAULT 'once',
  "target_value" REAL, "unit" TEXT, "target_date" TEXT, "recurrence" TEXT, "checkin_category_id" TEXT,
  "done_at" TEXT, "sort" REAL NOT NULL DEFAULT 0, "created_at" TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS "task_group" ON "task" ("group_id");
CREATE INDEX IF NOT EXISTS "task_date" ON "task" ("scheduled_date");
CREATE TABLE IF NOT EXISTS "dependency" (
  "id" TEXT PRIMARY KEY NOT NULL, "updated_at" TEXT NOT NULL, "deleted" INTEGER NOT NULL DEFAULT 0,
  "pred_id" TEXT NOT NULL, "succ_id" TEXT NOT NULL, "type" TEXT NOT NULL DEFAULT 'FS', "lag" INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS "dependency_pred" ON "dependency" ("pred_id");
CREATE INDEX IF NOT EXISTS "dependency_succ" ON "dependency" ("succ_id");
CREATE TABLE IF NOT EXISTS "group" (
  "id" TEXT PRIMARY KEY NOT NULL, "updated_at" TEXT NOT NULL, "deleted" INTEGER NOT NULL DEFAULT 0,
  "name" TEXT NOT NULL, "icon" TEXT NOT NULL DEFAULT '', "start_at" TEXT, "end_at" TEXT, "category_id" TEXT, "default_type_id" TEXT
);
CREATE TABLE IF NOT EXISTS "category" (
  "id" TEXT PRIMARY KEY NOT NULL, "updated_at" TEXT NOT NULL, "deleted" INTEGER NOT NULL DEFAULT 0,
  "name" TEXT NOT NULL, "color" TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS "task_type" (
  "id" TEXT PRIMARY KEY NOT NULL, "updated_at" TEXT NOT NULL, "deleted" INTEGER NOT NULL DEFAULT 0,
  "name" TEXT NOT NULL, "icon" TEXT NOT NULL, "color" TEXT NOT NULL, "layout" TEXT NOT NULL, "fields" TEXT NOT NULL DEFAULT '[]',
  "body_template" TEXT NOT NULL DEFAULT '', "builtin" INTEGER NOT NULL DEFAULT 0, "hidden" INTEGER NOT NULL DEFAULT 0,
  "default_completion_mode" TEXT NOT NULL DEFAULT 'once', "sort" REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS "person" (
  "id" TEXT PRIMARY KEY NOT NULL, "updated_at" TEXT NOT NULL, "deleted" INTEGER NOT NULL DEFAULT 0,
  "name" TEXT NOT NULL, "avatar_asset_id" TEXT, "relation" TEXT, "birthday" TEXT, "note_md" TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS "task_person" (
  "id" TEXT PRIMARY KEY NOT NULL, "updated_at" TEXT NOT NULL, "deleted" INTEGER NOT NULL DEFAULT 0,
  "task_id" TEXT NOT NULL, "person_id" TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS "task_person_task" ON "task_person" ("task_id");
CREATE TABLE IF NOT EXISTS "my_day" (
  "id" TEXT PRIMARY KEY NOT NULL, "updated_at" TEXT NOT NULL, "deleted" INTEGER NOT NULL DEFAULT 0,
  "task_id" TEXT NOT NULL, "date" TEXT NOT NULL, "sort" REAL NOT NULL DEFAULT 0, "added_at" TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS "my_day_date" ON "my_day" ("date");
CREATE TABLE IF NOT EXISTS "check_in" (
  "id" TEXT PRIMARY KEY NOT NULL, "updated_at" TEXT NOT NULL, "deleted" INTEGER NOT NULL DEFAULT 0,
  "task_id" TEXT NOT NULL, "period_key" TEXT NOT NULL, "kind" TEXT NOT NULL, "amount" REAL NOT NULL DEFAULT 0, "at" TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS "check_in_task" ON "check_in" ("task_id", "period_key");
CREATE TABLE IF NOT EXISTS "checkin_category" (
  "id" TEXT PRIMARY KEY NOT NULL, "updated_at" TEXT NOT NULL, "deleted" INTEGER NOT NULL DEFAULT 0,
  "name" TEXT NOT NULL, "icon" TEXT NOT NULL, "color" TEXT NOT NULL, "builtin" INTEGER NOT NULL DEFAULT 0,
  "hidden" INTEGER NOT NULL DEFAULT 0, "sort" REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS "asset" (
  "id" TEXT PRIMARY KEY NOT NULL, "updated_at" TEXT NOT NULL, "deleted" INTEGER NOT NULL DEFAULT 0,
  "sha256" TEXT NOT NULL, "mime" TEXT NOT NULL, "width" INTEGER, "height" INTEGER, "r2_key" TEXT, "url" TEXT
);
CREATE TABLE IF NOT EXISTS "outbox" (
  "seq" INTEGER PRIMARY KEY AUTOINCREMENT, "tbl" TEXT NOT NULL, "row_id" TEXT NOT NULL, "updated_at" TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS "meta" ("key" TEXT PRIMARY KEY NOT NULL, "value" TEXT NOT NULL);
`,
  },
];

export const SCHEMA_VERSION = MIGRATIONS.at(-1)!.version;
