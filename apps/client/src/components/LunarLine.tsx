/**
 * 日期标题旁的农历一行（Rei 2026-10-17）：「农历九月初八 · 国庆节 [休]」。我的一天副标题、列表每天的标题用。
 * 只读：订阅到的节日 / 节气 / 调休只显示，不成任务。没开「显示农历」时什么都不显示。
 */
import { lunarFestivalOf, lunarFullName, plainSubTitle, solarTermOf, solarToLunar, type DateKey } from '@mindough/core';
import { useLunar } from '../lib/lunar';
import { useStore } from '../store/StoreProvider';
import { tr } from '../lib/i18n';

export function LunarLine({ date, className }: { date: DateKey; className?: string }) {
  const lunar = useLunar(useStore());
  if (!lunar.show) return null;
  const l = solarToLunar(date);
  const { sub } = lunar.day(date);
  // 订阅的事件名（去掉（休）（班））优先；本地的节日、节气补上订阅里没有的
  const names: string[] = [];
  for (const t of sub?.titles ?? []) {
    const p = plainSubTitle(t);
    if (p && !names.includes(p)) names.push(p);
  }
  const local = [l ? lunarFestivalOf(l) : null, solarTermOf(date)].filter((x): x is string => !!x);
  for (const n of local) if (!names.some((x) => x.includes(n) || n.includes(x))) names.push(n);
  if (!l && !names.length) return null;
  return (
    <span className={`date-lunar${className ? ` ${className}` : ''}`}>
      {l && lunarFullName(l.month, l.day, l.leap)}
      {names.map((n) => (
        <span key={n}>
          {' · '}
          <span className="date-lunar-event">{n}</span>
        </span>
      ))}
      {sub?.badge && <span className={`lunar-tag is-${sub.badge}`}>{sub.badge === 'off' ? tr('休') : tr('班')}</span>}
    </span>
  );
}
