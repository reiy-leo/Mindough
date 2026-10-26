/**
 * 按「最近多少天」筛任务（Rei 2026-10-26：「之前导入dad365的问题解决了么，选择30天实际是全部的问题」；
 * 又说「现在是可以选30天、半年、全部的，但选择了30天，还是会导入全部」→ 范围对所有任务都生效）。
 * 连账户和备份 CSV 用同一个函数；「全部」不筛。按最后修改或完成的时间算，见 didaRangeTime。
 */
import { didaInstant } from './map';
import { tr } from '../i18n';
import type { DidaIssue, DidaRow } from './parse';

/** 时间字符串 → 毫秒；认不出 null（写法和导入其他地方一样，见 didaInstant）。 */
export function didaMs(stamp: string | null | undefined): number | null {
  const iso = didaInstant(stamp ?? null);
  return iso ? Date.parse(iso) : null;
}

/**
 * 一行按哪个时间算（毫秒）：
 * - 未完成：修改时间，没有就看创建时间
 * - 已完成：完成时间，没有就看修改时间、创建时间
 * - 已放弃：修改时间，没有就看完成时间、创建时间
 * 都认不出返回 null。
 */
export function didaRangeTime(row: Pick<DidaRow, 'status' | 'completed' | 'modified' | 'created'>): number | null {
  const order =
    row.status === 'open' ? [row.modified, row.created] : row.status === 'done' ? [row.completed, row.modified, row.created] : [row.modified, row.completed, row.created];
  for (const s of order) {
    const ms = didaMs(s);
    if (ms !== null) return ms;
  }
  return null;
}

/**
 * 这一行在不在范围里。days：null = 全部；N = 最近 N 天。
 * 一个时间都没有的说不清，照样留下（调用方会提示有几件）。
 */
export function didaRowInRange(row: DidaRow, days: number | null, now: Date = new Date()): boolean {
  if (days === null) return true;
  const t = didaRangeTime(row);
  if (t === null) return true;
  return t >= now.getTime() - days * 86_400_000;
}

/** 筛一批行：留下的、筛掉的件数、没有时间所以没法筛的件数。 */
export function filterDidaRows(rows: DidaRow[], days: number | null, now: Date = new Date()): { rows: DidaRow[]; dropped: number; undated: number } {
  if (days === null) return { rows, dropped: 0, undated: 0 };
  const kept = rows.filter((r) => didaRowInRange(r, days, now));
  return { rows: kept, dropped: rows.length - kept.length, undated: kept.filter((r) => didaRangeTime(r) === null).length };
}

/** 读出来的一批（连账户拉的或备份文件读的）按范围筛；没有时间的照样留下，加一条提示。 */
export function applyDidaRange(
  got: { rows: DidaRow[]; issues: DidaIssue[] },
  days: number | null,
  now: Date = new Date(),
): { rows: DidaRow[]; issues: DidaIssue[]; dropped: number } {
  const { rows, dropped, undated } = filterDidaRows(got.rows, days, now);
  const issues = undated ? [...got.issues, { line: 0, message: tr('{n} 件没有修改或完成时间，没法按范围筛，照样导入', { n: undated }), level: 'warning' as const }] : got.issues;
  return { rows, issues, dropped };
}
