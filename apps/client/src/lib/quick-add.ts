/**
 * 我的一天顶部的快速添加（Rei 2026-10-26「从这里添加任务后立即打开任务」）：
 * 回车建一件任务、放进今天，马上选中它——和点列表里一行一样（三列在右列、中等宽度两栏、手机整页推入，hash 写 ?task=id）。
 *
 * 焦点：照详情打开的老规矩，打开详情不抢焦点，也不把光标塞进正文。
 * - 宽屏 / 中等宽度：光标留在添加框里，可以接着写下一件；连着加几件，详情显示最后一件。
 * - 手机：详情整页盖住列表，添加框收起焦点，软键盘随之落下；要写正文再点正文。
 * 新任务滚到看得见的地方；连着加时只滚最后一件。
 */
import type { LayoutKind } from '../skin/platform';

export interface QuickAddDeps {
  createTask: (input: { body_md: string }) => { id: string };
  addToMyDay: (taskId: string, date: string) => void;
  openEditor: (taskId: string | null) => void;
}

/** 建任务、放进今天、打开详情。空白不建，返回 null。 */
export function quickAddToday(deps: QuickAddDeps, text: string, today: string): string | null {
  const body = text.trim();
  if (!body) return null;
  const t = deps.createTask({ body_md: body });
  deps.addToMyDay(t.id, today);
  deps.openEditor(t.id);
  return t.id;
}

let scrollToken = 0;

/**
 * 加完以后的收尾：手机上让添加框交出焦点（收起软键盘），再把新行滚进视野。
 * 列表要等下一帧才渲染出新行，所以放到 requestAnimationFrame 里；连着加时旧的那次作废。
 */
export function afterQuickAdd(taskId: string, input: HTMLElement | null, layout: LayoutKind, root: ParentNode = document): void {
  if (layout === 'mobile') input?.blur();
  const token = ++scrollToken;
  const scroll = (tries: number) => {
    if (token !== scrollToken) return;
    const row = root.querySelector<HTMLElement>(`.main [data-task-id="${CSS.escape(taskId)}"]`);
    if (row) row.scrollIntoView({ block: 'nearest' });
    else if (tries > 0) requestAnimationFrame(() => scroll(tries - 1));
  };
  requestAnimationFrame(() => scroll(3));
}
