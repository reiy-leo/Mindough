import { CycleError, DuplicateEdgeError, SelfLoopError, taskTitle, type CompleteResult, type Store, type TaskStatus } from '@mindough/core';
import type { useUi } from './ui';
import { resolver } from './view';

type Ui = ReturnType<typeof useUi>;

function titleOf(store: Store, id: string) {
  const t = store.get('task', id);
  return t ? taskTitle(t, store.get('task_type', t.type_id), resolver(store)) : '任务';
}

/** 完成后的提示：解锁了哪些后续 + “然后呢？”一键新建后续 + 撤销。 */
export function announceComplete(store: Store, ui: Ui, result: CompleteResult, prev: TaskStatus) {
  const n = result.unlocked.length;
  const names = result.unlocked.slice(0, 3).map((t) => `「${titleOf(store, t.id)}」`).join('、');
  ui.toast(
    {
      tone: 'success',
      message: n ? `已完成，解锁了 ${n} 个后续：${names}${n > 3 ? ' 等' : ''}` : `已完成「${titleOf(store, result.task.id)}」`,
      actions: [
        {
          label: '然后呢？',
          onPress: () => {
            const next = store.createSuccessor(result.task.id);
            ui.openEditor(next.id);
          },
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
  if (t.status === '完成') {
    store.setStatus(taskId, '待办');
    return;
  }
  announceComplete(store, ui, store.completeTask(taskId), t.status);
}

/** 加依赖：环检测失败时提示，返回是否成功。 */
export function tryAddDependency(store: Store, ui: Ui, predId: string, succId: string): boolean {
  try {
    store.addDependency(predId, succId);
    ui.toast({ tone: 'info', message: `已连接：「${titleOf(store, predId)}」完成后 →「${titleOf(store, succId)}」` }, 3500);
    return true;
  } catch (e) {
    if (e instanceof CycleError) {
      const path = e.path.map((id) => titleOf(store, id)).join(' → ');
      ui.toast({ tone: 'error', message: `不能连这条线：会形成环（${path}）` });
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
