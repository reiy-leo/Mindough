/**
 * 计数的步长和快捷加量（Rei 2026-10-26「如果是喝2000mL水的话，每次只能加1，太不合理了吧」）。
 *
 * 配置存在 task.count_config（JSON，SQLite 迁移 v9），随整行同步（行级 LWW）。
 * 空对象 = 老任务：步长 1，只有一个 +1 按钮，和以前一样。
 * 进度照旧由 check_in 的 add 事件累加；手输总数记成一条差值事件（可以是负数），撤销就是给那条事件打墓碑。
 */
import type { CountConfig } from './types';

/** 快捷按钮最多几个。 */
export const MAX_QUICK = 3;

/** 单位 → 默认步长（单位小写、去空格后查）。不认识的单位（自定义）默认 1。 */
const UNIT_STEP: Record<string, number> = {
  // 次数
  次: 1, 回: 1, 遍: 1, 下: 1, 个: 1, 件: 1, 组: 1, 杯: 1, 瓶: 1, 章: 1, 集: 1, 篇: 1, 首: 1, 节: 1,
  times: 1, time: 1, cups: 1, cup: 1, glasses: 1, glass: 1, sets: 1, set: 1,
  // 容量
  ml: 250, 毫升: 250, l: 0.5, 升: 0.5, 'fl oz': 8, oz: 8,
  // 页数
  页: 10, pages: 10, page: 10, p: 10,
  // 时长
  分钟: 5, 分: 5, min: 5, mins: 5, minutes: 5, minute: 5, 小时: 0.5, h: 0.5, hr: 0.5, hours: 0.5, hour: 0.5,
  // 距离、步数
  km: 1, 公里: 1, 千米: 1, mi: 1, 米: 100, m: 100, 步: 1000, steps: 1000, step: 1000,
  // 重量、热量
  g: 50, 克: 50, kg: 1, 公斤: 1, 斤: 1, kcal: 100, 千卡: 100, 大卡: 100,
  // 字数
  字: 500, words: 500, word: 500,
};

/** 「次」这类单位只给一个快捷按钮（+1）。 */
const TIMES_UNITS = new Set(['', '次', '回', '遍', '下', 'times', 'time']); // i18n-ignore 单位匹配用的原文

const unitKey = (unit: string | null | undefined) => (unit ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** 小数最多留两位，去掉浮点误差（0.1 + 0.2 = 0.3）。 */
export function roundAmount(n: number): number {
  return Math.round(n * 100) / 100;
}

const positive = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;

/** 单位的默认步长。 */
export function defaultStepFor(unit: string | null | undefined): number {
  return UNIT_STEP[unitKey(unit)] ?? 1;
}

/** 读配置：不认识的形状当空对象（老数据、坏数据都不出错）。 */
export function countConfigOf(task: { count_config?: CountConfig | null }): CountConfig {
  const c = task.count_config;
  return c && typeof c === 'object' && !Array.isArray(c) ? c : {};
}

/** 每次加多少：设过就用设过的，没设过（老任务）是 1。 */
export function countStep(task: { count_config?: CountConfig | null }): number {
  const s = countConfigOf(task).step;
  return positive(s) ? roundAmount(s) : 1;
}

/** 清理快捷按钮：正数、两位小数、去重、最多三个。 */
export function cleanQuick(list: readonly unknown[]): number[] {
  const out: number[] = [];
  for (const v of list) {
    if (!positive(v)) continue;
    const n = roundAmount(v);
    if (n > 0 && !out.includes(n)) out.push(n);
    if (out.length >= MAX_QUICK) break;
  }
  return out;
}

/** 没手动设过时的默认快捷按钮：步长、步长 × 2；「次」只给步长。 */
export function defaultQuick(step: number, unit: string | null | undefined): number[] {
  return TIMES_UNITS.has(unitKey(unit)) ? [step] : cleanQuick([step, step * 2]);
}

/**
 * 任务上显示的快捷按钮。
 * - 手动设过（quick 是数组）：照设的显示，删光了退回步长一个。
 * - 老任务（配置是空的）：只有 +1，和以前一样。
 * - 其余：defaultQuick。
 */
export function quickAmounts(task: { count_config?: CountConfig | null; unit: string | null }): number[] {
  const c = countConfigOf(task);
  const step = countStep(task);
  if (Array.isArray(c.quick)) {
    const q = cleanQuick(c.quick);
    return q.length ? q : [step];
  }
  if (!positive(c.step)) return [step];
  return defaultQuick(step, task.unit);
}

/** 新建计数任务时的配置：按单位填默认步长。 */
export function newCountConfig(unit: string | null | undefined): CountConfig {
  return { step: defaultStepFor(unit) };
}

/** 改单位：没手改过步长就换成新单位的默认步长；手改过不动。快捷按钮不动（没设过的会跟着步长变）。 */
export function countConfigForUnit(cfg: CountConfig, unit: string | null | undefined): CountConfig {
  if (cfg.step_set) return cfg;
  return { ...cfg, step: defaultStepFor(unit) };
}

/** 手改步长：记下改过，以后换单位不覆盖。 */
export function countConfigWithStep(cfg: CountConfig, step: number): CountConfig {
  return positive(step) ? { ...cfg, step: roundAmount(step), step_set: true } : cfg;
}

/** 改快捷按钮（空数组 = 退回只有步长一个）。 */
export function countConfigWithQuick(cfg: CountConfig, quick: readonly number[]): CountConfig {
  return { ...cfg, quick: cleanQuick(quick) };
}

/**
 * 手输框里的字变成要加的量：「+330」「-100」是加减这么多，「1200」是直接改成总数（返回差值）。
 * 看不懂、或者差值是 0 返回 null。
 */
export function parseCountInput(text: string, current: number): number | null {
  const s = text.trim().replace(/[，,]/g, '').replace(/＋/g, '+').replace(/[－−]/g, '-');
  const m = /^([+-])?\s*(\d+(?:\.\d+)?|\.\d+)$/.exec(s);
  if (!m) return null;
  const n = Number(m[2]);
  if (!Number.isFinite(n)) return null;
  const delta = m[1] === '+' ? n : m[1] === '-' ? -n : n - current;
  const d = roundAmount(delta);
  return d === 0 ? null : d;
}

/** 显示数量：最多两位小数，不带千分位（跟输入框一样）。 */
export function formatAmount(n: number): string {
  return String(roundAmount(n));
}

/** 快捷按钮上的字：「+250」「−100」。 */
export function formatDelta(n: number): string {
  return n < 0 ? `−${formatAmount(-n)}` : `+${formatAmount(n)}`;
}
