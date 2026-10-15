import { useState } from 'react';
import { Button as RacButton } from 'react-aria-components';
import { CalendarRange, LayoutGrid, List, Network, Plus, Shapes } from 'lucide-react';
import { formatDateZh, toDateKey, type Group, type Task } from '@mindough/core';
import { useStore } from '../store/StoreProvider';
import { useUi } from '../lib/ui';
import { navigate } from '../lib/router';
import { Button, Chip, Empty, Field, ProgressBar, Section, Segmented, Select, Sheet } from '../ui/primitives';
import { TaskRow } from '../components/TaskRow';
import { TaskCard } from '../components/TaskCard';
import { PageHeader } from '../components/PageHeader';
import { LazyGraph as DependencyGraph } from '../components/LazyGraph';

function range(g: Group) {
  if (!g.start_at && !g.end_at) return '不限时间';
  return `${g.start_at ? formatDateZh(g.start_at, false) : '…'} – ${g.end_at ? formatDateZh(g.end_at, false) : '…'}`;
}

function GroupDialog({ onClose }: { onClose: () => void }) {
  const store = useStore();
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('📁');
  const [cat, setCat] = useState('__none');
  const [type, setType] = useState('__none');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  return (
    <Sheet
      isOpen
      onOpenChange={(o) => !o && onClose()}
      title="新建组"
      footer={
        <Button
          variant="primary"
          isDisabled={!name.trim()}
          onPress={() => {
            const g = store.insert('group', {
              name: name.trim(),
              icon: icon || '📁',
              start_at: start || null,
              end_at: end || null,
              category_id: cat === '__none' ? null : cat,
              default_type_id: type === '__none' ? null : type,
            });
            onClose();
            navigate({ page: 'group', id: g.id });
          }}
        >
          创建
        </Button>
      }
    >
      <div className="editor-grid">
        <Field label="名称" value={name} onChange={setName} autoFocus />
        <Field label="图标（emoji）" value={icon} onChange={setIcon} />
        <Field label="开始" type="date" value={start} onChange={setStart} />
        <Field label="结束" type="date" value={end} onChange={setEnd} />
        <Select label="分类" value={cat} onChange={setCat} options={[{ id: '__none', label: '无' }, ...store.list('category').map((c) => ({ id: c.id, label: c.name }))]} />
        <Select
          label="默认类型"
          value={type}
          onChange={setType}
          options={[{ id: '__none', label: '普通' }, ...store.list('task_type').filter((t) => t.layout !== 'text').map((t) => ({ id: t.id, label: t.name }))]}
        />
      </div>
    </Sheet>
  );
}

export function GroupsPage() {
  const store = useStore();
  const [creating, setCreating] = useState(false);
  const [cat, setCat] = useState('all');
  const categories = store.list('category');
  const groups = store.list('group').filter((g) => cat === 'all' || g.category_id === cat);
  return (
    <div className="page">
      <PageHeader
        title="组"
        subtitle="一组相关的任务，有起止时间和分类"
        icon={<Shapes size={22} />}
        actions={
          <Button variant="primary" onPress={() => setCreating(true)}>
            <Plus size={16} />
            新建组
          </Button>
        }
      />
      <div className="filter-row">
        <Segmented label="按分类筛选" value={cat} onChange={setCat} options={[{ id: 'all', label: '全部' }, ...categories.map((c) => ({ id: c.id, label: c.name }))]} />
      </div>
      {groups.length === 0 ? (
        <Empty title="还没有组" hint="组用来装一批相关任务，比如“搬家”“开发某个功能”" />
      ) : (
        <div className="card-grid">
          {groups.map((g) => {
            const tasks = store.tasks().filter((t) => t.group_id === g.id);
            const done = tasks.filter((t) => t.status === '完成').length;
            const blocked = tasks.filter((t) => store.derived().get(t.id)?.state === '被阻塞').length;
            const c = store.get('category', g.category_id);
            const late = g.end_at && g.end_at < toDateKey(store.now()) && done < tasks.length;
            return (
              <RacButton key={g.id} className="card group-card" onPress={() => navigate({ page: 'group', id: g.id })}>
                <div className="group-card-head">
                  <span className="group-icon">{g.icon}</span>
                  <span className="group-name">{g.name}</span>
                  {c && <Chip color={c.color}>{c.name}</Chip>}
                </div>
                <div className={`group-range${late ? ' is-late' : ''}`}>
                  <CalendarRange size={13} /> {range(g)}
                </div>
                <ProgressBar value={tasks.length ? done / tasks.length : 0} color={c?.color} />
                <div className="group-stats">
                  <span>
                    {done}/{tasks.length} 完成
                  </span>
                  {blocked > 0 && <span className="state-blocked">{blocked} 个被阻塞</span>}
                </div>
              </RacButton>
            );
          })}
        </div>
      )}
      {creating && <GroupDialog onClose={() => setCreating(false)} />}
    </div>
  );
}

export function GroupDetailPage({ id }: { id: string }) {
  const store = useStore();
  const ui = useUi();
  const [view, setView] = useState<'list' | 'cards' | 'graph'>('list');
  const g = store.get('group', id);
  if (!g) return <Empty title="找不到这个组" hint="可能已经删除了" />;
  const tasks: Task[] = store.tasks().filter((t) => t.group_id === id);
  const c = store.get('category', g.category_id);
  const open = tasks.filter((t) => t.status !== '完成' && t.status !== '取消');
  const closed = tasks.filter((t) => t.status === '完成' || t.status === '取消');
  const defType = store.get('task_type', g.default_type_id);
  return (
    <div className="page">
      <PageHeader
        title={g.name}
        icon={<span className="page-emoji">{g.icon}</span>}
        subtitle={
          <>
            {range(g)}
            {c && <> · {c.name}</>}
            {defType && <> · 默认类型：{defType.name}</>}
          </>
        }
        actions={
          <Button variant="primary" onPress={() => ui.openQuickCreate({ group_id: g.id })}>
            <Plus size={16} />
            新建任务
          </Button>
        }
      />
      <div className="filter-row">
        <Segmented
          label="视图"
          value={view}
          onChange={setView}
          options={[
            { id: 'list', label: <><List size={14} /> 列表</> },
            { id: 'cards', label: <><LayoutGrid size={14} /> 卡片</> },
            { id: 'graph', label: <><Network size={14} /> 依赖图</> },
          ]}
        />
      </div>
      {view === 'graph' ? (
        <DependencyGraph store={store} tasks={tasks} height="min(560px, 64vh)" />
      ) : view === 'cards' ? (
        <div className="task-card-grid">
          {tasks.map((t) => (
            <TaskCard key={t.id} store={store} task={t} />
          ))}
        </div>
      ) : (
        <>
          <div className="task-list plain">
            {open.map((t) => (
              <TaskRow key={t.id} store={store} task={t} showGroup={false} showDate />
            ))}
            {!open.length && <Empty title="组里的任务都做完了" />}
          </div>
          {closed.length > 0 && (
            <Section title={`已完成 ${closed.length}`}>
              <div className="task-list plain">
                {closed.map((t) => (
                  <TaskRow key={t.id} store={store} task={t} showGroup={false} showDate />
                ))}
              </div>
            </Section>
          )}
        </>
      )}
    </div>
  );
}
