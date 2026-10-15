import { useState } from 'react';
import { Network } from 'lucide-react';
import { useStore } from '../store/StoreProvider';
import { Select } from '../ui/primitives';
import { PageHeader } from '../components/PageHeader';
import { LazyGraph as DependencyGraph } from '../components/LazyGraph';
import { useSettings } from '../lib/settings';

export function GraphPage() {
  const store = useStore();
  const { layout } = useSettings();
  const [scope, setScope] = useState('linked');
  const [hideDone, setHideDone] = useState('all');
  let tasks = store.tasks().filter((t) => !t.recurrence && t.completion_mode !== 'countdown');
  if (scope === 'linked') {
    const linked = new Set(store.edges().flatMap((e) => [e.pred_id, e.succ_id]));
    tasks = tasks.filter((t) => linked.has(t.id));
  } else if (scope !== 'all') tasks = tasks.filter((t) => t.group_id === scope);
  if (hideDone === 'open') tasks = tasks.filter((t) => t.status !== '完成' && t.status !== '取消');
  return (
    <div className="page page-fill">
      <PageHeader
        title="依赖图"
        subtitle={layout === 'mobile' ? '拖动节点边缘的圆点连线' : '从节点右侧圆点拖到另一个任务，即“完成后才能开始”；选中连线按 Delete 删除；双击节点编辑'}
        icon={<Network size={22} />}
      />
      <div className="filter-row graph-toolbar">
        <Select
          label="范围"
          value={scope}
          onChange={setScope}
          options={[
            { id: 'linked', label: '有依赖的任务' },
            { id: 'all', label: '全部任务' },
            ...store.list('group').map((g) => ({ id: g.id, label: `${g.icon} ${g.name}` })),
          ]}
        />
        <Select label="显示" value={hideDone} onChange={setHideDone} options={[{ id: 'all', label: '含已完成' }, { id: 'open', label: '只看未完成' }]} />
        <div className="graph-legend" aria-label="图例">
          <span className="legend state-done">完成</span>
          <span className="legend state-ready">可开始</span>
          <span className="legend state-blocked">被阻塞</span>
        </div>
      </div>
      <DependencyGraph store={store} tasks={tasks} height="100%" />
    </div>
  );
}
