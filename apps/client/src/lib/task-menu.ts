/**
 * 任务详情顶栏「…」菜单里有哪些项、按什么顺序、哪里加分隔线。
 * 「关闭」从详情底部挪进这里（Rei 2026-10-17「任务窗口底部的close按钮，移动到ellipsis下拉菜单中去」）：
 * 我的一天 ｜ 状态（直接标为完成、关闭 / 不再打卡，结束了的换成 重新打开 / 恢复打卡） ｜ 删除…
 * 纯逻辑，好测；TaskDetail 按 id 接上动作和图标。
 */
import { isFinished, type Task } from '@mindough/core';
import { tr } from './i18n';

export type DetailMenuId = 'myday' | 'done' | 'close' | 'reopen' | 'delete';

export interface DetailMenuEntry {
  id: DetailMenuId;
  label: string;
  danger?: boolean;
  /** 这一项前面画一条分隔线（换了一组） */
  separator?: boolean;
}

export function detailMenu(task: Pick<Task, 'status' | 'recurrence' | 'completion_mode'>, inDay: boolean): DetailMenuEntry[] {
  const finished = isFinished(task.status);
  const recurring = !!task.recurrence;
  const out: DetailMenuEntry[] = [{ id: 'myday', label: inDay ? tr('移出我的一天') : tr('加入我的一天') }];
  const status: DetailMenuEntry[] = [];
  if (finished) status.push({ id: 'reopen', label: recurring ? tr('恢复打卡') : tr('重新打开') });
  else {
    // 勾选完成的任务底部本来就有「完成」，这里不重复
    if (!recurring && task.completion_mode !== 'once') status.push({ id: 'done', label: tr('直接标为完成') });
    status.push({ id: 'close', label: recurring ? tr('不再打卡') : tr('关闭') });
  }
  status[0]!.separator = true;
  out.push(...status, { id: 'delete', label: tr('删除…'), danger: true, separator: true });
  return out;
}
