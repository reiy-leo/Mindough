/**
 * 项目页「看板」视图（Rei 2026-10-26「每个项目的视图支持列表、看板、时间轴」）：
 * 按任务状态分四列（待办 / 进行中 / 完成 / 关闭），列内按当前排序。
 * 卡片拖到别的列就改成那一列的状态（结束态照常弹解锁提示、能撤销）；键盘：聚焦卡片左边的拖动把手按回车，方向键选列，回车放下（React Aria 拖放）。
 * 宽度不够时整个看板横向滚动。
 */
import { GridList, GridListItem, useDragAndDrop, Button as RacButton, type DropItem } from 'react-aria-components';
import { GripVertical } from 'lucide-react';
import { TASK_STATUS_LABEL, type Store, type Task, type TaskStatus } from '@mindough/core';
import { useUi } from '../../lib/ui';
import { changeStatus } from '../../lib/actions';
import { boardColumns } from '../../lib/project-view';
import { useReorderGuard } from '../../lib/drag-guard';
import { titleOf } from '../../lib/view';
import { TaskRow } from '../TaskRow';

import { tr } from '../../lib/i18n';

const DRAG_TYPE = 'application/x-mindough-task';

async function idsOf(items: readonly DropItem[]): Promise<string[]> {
  const out: string[] = [];
  for (const it of items) if (it.kind === 'text' && it.types.has(DRAG_TYPE)) out.push(await it.getText(DRAG_TYPE));
  return out;
}

function Column({ store, status, tasks }: { store: Store; status: TaskStatus; tasks: Task[] }) {
  const ui = useUi();
  const guard = useReorderGuard();
  const moveHere = async (items: readonly DropItem[]) => {
    for (const id of await idsOf(items)) changeStatus(store, ui, id, status);
  };
  const { dragAndDropHooks } = useDragAndDrop({
    ...guard.handlers,
    getItems: (keys) =>
      [...keys].map((k) => {
        const t = store.get('task', String(k));
        return { [DRAG_TYPE]: String(k), 'text/plain': t ? titleOf(store, t) : String(k) };
      }),
    acceptedDragTypes: [DRAG_TYPE],
    getDropOperation: () => 'move',
    onRootDrop: (e) => void moveHere(e.items),
    onInsert: (e) => void moveHere(e.items),
    onItemDrop: (e) => void moveHere(e.items),
  });
  const label = TASK_STATUS_LABEL[status];
  return (
    <section className={`board-col is-${status === '待办' ? 'todo' : status === '进行中' ? 'doing' : status === '完成' ? 'done' : 'closed'}`} aria-label={label}>
      <header className="board-col-head">
        <span className="board-col-dot" aria-hidden />
        <span className="board-col-title">{label}</span>
        <span className="board-col-count">{tasks.length}</span>
      </header>
      <GridList
        ref={guard.ref}
        aria-label={tr('{status}的任务', { status: label })}
        className="board-list"
        dragAndDropHooks={dragAndDropHooks}
        dependencies={[ui.editingId, store.version]}
        items={tasks}
        renderEmptyState={() => <div className="board-empty">{tr('拖到这里')}</div>}
      >
        {(t) => (
          <GridListItem id={t.id} textValue={titleOf(store, t) || tr('任务')} className="board-card">
            <RacButton slot="drag" className="drag-handle" aria-label={tr('拖到别的状态')}>
              <GripVertical size={14} />
            </RacButton>
            <TaskRow store={store} task={t} showGroup={false} showDate />
          </GridListItem>
        )}
      </GridList>
    </section>
  );
}

export function ProjectBoard({ store, tasks }: { store: Store; tasks: Task[] }) {
  return (
    <div className="board" role="group" aria-label={tr('看板')}>
      {boardColumns(tasks).map((c) => (
        <Column key={c.status} store={store} status={c.status} tasks={c.tasks} />
      ))}
    </div>
  );
}
