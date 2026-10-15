import { CycleError, DuplicateEdgeError, SelfLoopError, isFinished, taskTitle, type CompleteResult, type Store, type TaskStatus } from '@mindough/core';
import type { useUi } from './ui';
import { resolver } from './view';

type Ui = ReturnType<typeof useUi>;

function titleOf(store: Store, id: string) {
  const t = store.get('task', id);
  return t ? taskTitle(t, store.get('task_type', t.type_id), resolver(store)) : '任务';
}

/** 结束（完成 / 关闭）后的提示：解锁了哪些后续 + “然后呢？”一键新建后续 + 撤销。 */
export function announceComplete(store: Store, ui: Ui, result: CompleteResult, prev: TaskStatus) {
  const n = result.unlocked.length;
  const names = result.unlocked.slice(0, 3).map((t) => `「${titleOf(store, t.id)}」`).join('、');
  const verb = result.task.status === '关闭' ? '已关闭' : '已完成';
  ui.toast(
    {
      tone: result.task.status === '关闭' ? 'info' : 'success',
      message: n ? `${verb}，接下来可以做 ${names}${n > 3 ? ` 等 ${n} 件事` : ''}` : `${verb}「${titleOf(store, result.task.id)}」`,
      actions: [
        {
          label: '然后呢？',
          onPress: () => ui.openQuickCreate({ group_id: result.task.group_id }, { after: result.task.id }),
        },
        { label: '撤销', onPress: () => store.setStatus(result.task.id, prev) },
      ],
    },
    7000,
  );
}

export function toggleDone(store: Store, ui: Ui, taskId: string) {
  const t = store.get('task', taskId);
  if (!t) return;
  // 已结束（完成或关闭）再点一下 = 重新打开
  if (isFinished(t.status)) {
    store.reopenTask(taskId);
    return;
  }
  announceComplete(store, ui, store.completeTask(taskId), t.status);
}

/** 关闭：不做了，也算结束（同样解锁后续），但不算成就。 */
export function closeTask(store: Store, ui: Ui, taskId: string) {
  const t = store.get('task', taskId);
  if (!t || t.status === '关闭') return;
  announceComplete(store, ui, store.closeTask(taskId), t.status);
}

/** 改状态：结束态走解锁提示，其余直接改。 */
export function changeStatus(store: Store, ui: Ui, taskId: string, status: TaskStatus) {
  const t = store.get('task', taskId);
  if (!t || t.status === status) return;
  if (isFinished(status)) announceComplete(store, ui, store.setStatus(taskId, status), t.status);
  else store.setStatus(taskId, status);
}

/** 加依赖：环检测失败时提示，返回是否成功。 */
export function tryAddDependency(store: Store, ui: Ui, predId: string, succId: string): boolean {
  try {
    store.addDependency(predId, succId);
    ui.toast({ tone: 'info', message: `已连上：做完「${titleOf(store, predId)}」，就能开始「${titleOf(store, succId)}」` }, 3500);
    return true;
  } catch (e) {
    if (e instanceof CycleError) {
      const path = e.path.map((id) => titleOf(store, id)).join(' → ');
      ui.toast({ tone: 'error', message: `没有连上：这样会绕成一个圈（${path}）` });
    } else if (e instanceof SelfLoopError || e instanceof DuplicateEdgeError) {
      ui.toast({ tone: 'error', message: e.message });
    } else throw e;
    return false;
  }
}

export function toggleMyDay(store: Store, ui: Ui, taskId: string) {
  if (store.isInMyDay(taskId)) {
    store.removeFromMyDay(taskId);
    ui.toast({ message: '已移出我的一天' }, 2500);
  } else {
    store.addToMyDay(taskId);
    ui.toast({ tone: 'success', message: `已加入我的一天：「${titleOf(store, taskId)}」` }, 2500);
  }
}
