import { compareDateKey } from '@mindough/core';
import { useStore } from '../store/StoreProvider';
import { Empty, Section } from '../ui/primitives';
import { TaskRow } from '../components/TaskRow';
import { QuickAddBar } from '../components/QuickAddBar';

import { tr } from '../lib/i18n';
/** 可做清单：所有“可开始”的任务，按组和日期排。 */
export function DoablePage() {
  const store = useStore();
  const derived = store.derived();
  const ready = store
    .tasks()
    .filter((t) => derived.get(t.id)?.state === '可开始' && !t.recurrence && t.completion_mode !== 'countdown')
    .sort((a, b) => compareDateKey(a.scheduled_date ?? '9999', b.scheduled_date ?? '9999'));
  const groups = new Map<string, typeof ready>();
  for (const t of ready) groups.set(t.group_id ?? '', [...(groups.get(t.group_id ?? '') ?? []), t]);
  const keys = [...groups.keys()].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : 0));
  return (
    <div className="page">
      {/* 中间列不放页头（Rei 2026-10-26）：最上面是添加框。可做页新建本来就进待安排（和右下角新建一样），
          新任务没有前置，所以马上出现在下面「琐事」里；件数挪到列表上方的小字 */}
      <QuickAddBar placeholder={tr('现在想做什么？按回车添加到待安排')} label={tr('添加任务到待安排')} create={(body) => store.createTask({ body_md: body }).id} />
      <div className="list-meta">
        <h1 className="sr-only">{tr('可做')}</h1>
        {tr('{length} 件任务的前置都已完成，现在就能开始', { length: ready.length })}
      </div>
      {ready.length === 0 && <Empty title={tr('没有可开始的任务')} />}
      {keys.map((k) => {
        const g = store.get('group', k);
        return (
          <Section key={k || 'none'} title={g ? `${g.icon} ${g.name}` : tr('琐事')}>
            <div className="task-list plain">
              {groups.get(k)!.map((t) => (
                <TaskRow key={t.id} store={store} task={t} showGroup={false} showDate />
              ))}
            </div>
          </Section>
        );
      })}
    </div>
  );
}
