/**
 * 待安排：还没定哪天做、也没放进今天的事（core backlog.ts）。行上：加入我的一天（太阳）、安排日期、拖动排序。
 * 新建的任务（不是从我的一天新建的）默认都在这里。
 */
import { GridList, GridListItem, useDragAndDrop, Button as RacButton } from 'react-aria-components';
import { CalendarPlus, GripVertical, Inbox, Plus } from 'lucide-react';
import { toDateKey } from '@mindough/core';
import { useStore } from '../store/StoreProvider';
import { useUi } from '../lib/ui';
import { Button, PopoverPanel } from '../ui/primitives';
import { TaskRow } from '../components/TaskRow';
import { PageHeader } from '../components/PageHeader';
import { DatePanel } from '../components/task/DatePanel';
import { titleOf } from '../lib/view';

import { tr } from '../lib/i18n';
export function BacklogPage() {
  const store = useStore();
  const ui = useUi();
  const today = toDateKey(store.now());
  const list = store.backlog(today);

  const { dragAndDropHooks } = useDragAndDrop({
    getItems: (keys) => [...keys].map((k) => ({ 'text/plain': String(k) })),
    onReorder: (e) => {
      const order = list.map((t) => t.id);
      const moving = [...e.keys].map(String);
      const rest = order.filter((id) => !moving.includes(id));
      const targetIdx = rest.indexOf(String(e.target.key));
      rest.splice(e.target.dropPosition === 'before' ? targetIdx : targetIdx + 1, 0, ...moving);
      store.reorderBacklog(rest);
    },
  });

  return (
    <div className="page">
      <PageHeader
        title={tr('待安排')}
        subtitle={list.length ? tr('{length} 件还没定哪天做', { length: list.length }) : tr('都安排好了')}
        icon={<Inbox size={22} />}
        actions={
          <Button variant="primary" className="hide-mobile" onPress={() => ui.openQuickCreate()}>
            <Plus size={16} />
            {tr('新建任务')}</Button>
        }
      />
      {list.length ? (
        <GridList aria-label={tr('待安排的任务')} className="task-list" dragAndDropHooks={dragAndDropHooks} items={list}>
          {(t) => (
            <GridListItem id={t.id} textValue={titleOf(store, t) || tr('任务')} className="list-item">
              <RacButton slot="drag" className="drag-handle" aria-label={tr('拖动排序')}>
                <GripVertical size={14} />
              </RacButton>
              <TaskRow
                store={store}
                task={t}
                trailing={
                  <PopoverPanel
                    label={tr('安排日期')}
                    trigger={
                      <RacButton className="icon-btn" aria-label={tr('安排日期')}>
                        <CalendarPlus size={17} />
                      </RacButton>
                    }
                  >
                    {(close) => (
                      <DatePanel
                        value={t.scheduled_date}
                        today={today}
                        clearLabel={null}
                        onChange={(d) => {
                          store.updateTask(t.id, { scheduled_date: d });
                          close();
                          if (d) ui.toast({ message: tr('已安排到列表：「{titleOf}」', { titleOf: titleOf(store, t) }) }, 2500);
                        }}
                      />
                    )}
                  </PopoverPanel>
                }
              />
            </GridListItem>
          )}
        </GridList>
      ) : (
        <div className="empty empty-backlog">
          <div className="empty-icon">
            <Inbox size={28} />
          </div>
          <div className="empty-title">{tr('没有待安排的事')}</div>
          <div className="empty-hint">{tr('想到什么先记下来，有空再决定哪天做。')}</div>
          <Button variant="secondary" onPress={() => ui.openQuickCreate()}>
            <Plus size={15} />
            {tr('记一件事')}</Button>
        </div>
      )}
    </div>
  );
}
