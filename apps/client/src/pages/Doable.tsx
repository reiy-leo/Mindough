import { ListChecks } from 'lucide-react';
import { compareDateKey } from '@mindough/core';
import { useStore } from '../store/StoreProvider';
import { Empty, Section } from '../ui/primitives';
import { TaskRow } from '../components/TaskRow';
import { PageHeader } from '../components/PageHeader';

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
      <PageHeader title="可做" subtitle={`${ready.length} 件任务的前置都已完成，现在就能开始`} icon={<ListChecks size={22} />} />
      {ready.length === 0 && <Empty title="没有可开始的任务" />}
      {keys.map((k) => {
        const g = store.get('group', k);
        return (
          <Section key={k || 'none'} title={g ? `${g.icon} ${g.name}` : '琐事'}>
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
