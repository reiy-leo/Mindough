import { useState } from 'react';
import { Network } from 'lucide-react';
import { isFinished } from '@mindough/core';
import { useStore } from '../store/StoreProvider';
import { Select } from '../ui/primitives';
import { PageHeader } from '../components/PageHeader';
import { LazyGraph as DependencyGraph } from '../components/LazyGraph';
import { useSettings } from '../lib/settings';

import { tr } from '../lib/i18n';
export function GraphPage() {
  const store = useStore();
  const { layout } = useSettings();
  const [scope, setScope] = useState('linked');
  const [hideDone, setHideDone] = useState('all');
  let tasks = store.tasks().filter((t) => !t.recurrence && t.completion_mode !== 'countdown');
  if (scope === 'linked') {
    const linked = new Set([...store.edges().flatMap((e) => [e.pred_id, e.succ_id]), ...store.taskLinks().flatMap((l) => [l.a_task_id, l.b_task_id])]);
    tasks = tasks.filter((t) => linked.has(t.id));
  } else if (scope !== 'all') tasks = tasks.filter((t) => t.group_id === scope);
  if (hideDone === 'open') tasks = tasks.filter((t) => !isFinished(t.status));
  return (
    <div className="page page-fill">
      <PageHeader
        title={tr('关系图')}
        subtitle={layout === 'mobile' ? tr('拖动任务边上的圆点，连到下一件事') : tr('从任务右边的圆点拖到另一件任务上，表示“做完这件才能开始那件”。选中连线按 Delete 删除，双击任务查看详情')}
        icon={<Network size={22} />}
      />
      <div className="filter-row graph-toolbar">
        <Select
          label={tr('范围')}
          value={scope}
          onChange={setScope}
          options={[
            { id: 'linked', label: tr('有关系的') },
            { id: 'all', label: tr('全部任务') },
            ...store.list('group').map((g) => ({ id: g.id, label: `${g.icon} ${g.name}` })),
          ]}
        />
        <Select label={tr('显示')} value={hideDone} onChange={setHideDone} options={[{ id: 'all', label: tr('含已完成') }, { id: 'open', label: tr('只看未完成') }]} />
        <div className="graph-legend" aria-label={tr('图例')}>
          <span className="legend state-done">{tr('完成')}</span>
          <span className="legend state-ready">{tr('可开始')}</span>
          <span className="legend state-blocked">{tr('还不能开始')}</span>
          <span className="legend state-closed">{tr('关闭')}</span>
          <span className="legend legend-related">{tr('相关（不分先后）')}</span>
        </div>
      </div>
      <DependencyGraph store={store} tasks={tasks} height="100%" />
    </div>
  );
}
