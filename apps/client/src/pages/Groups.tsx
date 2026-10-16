import { useState } from 'react';
import { Button as RacButton } from 'react-aria-components';
import { CalendarRange, LayoutGrid, List, Network, Plus, Shapes } from 'lucide-react';
import { formatDateZh, isFinished, toDateKey, type Group, type Task } from '@mindough/core';
import { useStore } from '../store/StoreProvider';
import { useUi } from '../lib/ui';
import { navigate } from '../lib/router';
import { Button, Chip, Empty, Field, ProgressBar, Section, Segmented, Select, Sheet } from '../ui/primitives';
import { TaskRow } from '../components/TaskRow';
import { TaskCard } from '../components/TaskCard';
import { PageHeader } from '../components/PageHeader';
import { LazyGraph as DependencyGraph } from '../components/LazyGraph';

import { dataLabel, tr, trc } from '../lib/i18n';
function range(g: Group) {
  if (!g.start_at && !g.end_at) return tr('不限时间');
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
      title={tr('新建组')}
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
          {tr('创建')}</Button>
      }
    >
      <div className="editor-grid">
        <Field label={tr('名称')} value={name} onChange={setName} autoFocus />
        <Field label={tr('图标（emoji）')} value={icon} onChange={setIcon} />
        <Field label={tr('开始')} type="date" value={start} onChange={setStart} />
        <Field label={tr('结束')} type="date" value={end} onChange={setEnd} />
        <Select label={tr('分类')} value={cat} onChange={setCat} options={[{ id: '__none', label: tr('无') }, ...store.list('category').map((c) => ({ id: c.id, label: c.name }))]} />
        <Select
          label={tr('默认类型')}
          value={type}
          onChange={setType}
          options={[{ id: '__none', label: tr('普通') }, ...store.pickableTypes().filter((t) => t.layout !== 'text').map((t) => ({ id: t.id, label: dataLabel(t.name) }))]}
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
        title={trc('导航', '组')}
        subtitle={tr('一组相关的任务，有起止时间和分类')}
        icon={<Shapes size={22} />}
        actions={
          <Button variant="primary" onPress={() => setCreating(true)}>
            <Plus size={16} />
            {tr('新建组')}</Button>
        }
      />
      <div className="filter-row">
        <Segmented label={tr('按分类筛选')} value={cat} onChange={setCat} options={[{ id: 'all', label: tr('全部') }, ...categories.map((c) => ({ id: c.id, label: c.name }))]} />
      </div>
      {groups.length === 0 ? (
        <Empty title={tr('还没有组')} hint={tr('组用来装一批相关任务，比如“搬家”“开发某个功能”')} />
      ) : (
        <div className="card-grid">
          {groups.map((g) => {
            const tasks = store.tasks().filter((t) => t.group_id === g.id);
            // 关闭的不算成就：既不算完成，也不计入总数
            const counted = tasks.filter((t) => t.status !== '关闭');
            const done = counted.filter((t) => t.status === '完成').length;
            const blocked = tasks.filter((t) => store.derived().get(t.id)?.state === '被阻塞').length;
            const c = store.get('category', g.category_id);
            const late = g.end_at && g.end_at < toDateKey(store.now()) && done < counted.length;
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
                <ProgressBar value={counted.length ? done / counted.length : 0} color={c?.color} />
                <div className="group-stats">
                  <span>
                    {tr('{done}/{length} 完成', { done, length: counted.length })}</span>
                  {blocked > 0 && <span className="state-blocked">{tr('{blocked} 件还不能开始', { blocked })}</span>}
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
  if (!g) return <Empty title={tr('找不到这个组')} hint={tr('可能已经删除了')} />;
  const tasks: Task[] = store.tasks().filter((t) => t.group_id === id);
  const c = store.get('category', g.category_id);
  const open = tasks.filter((t) => !isFinished(t.status));
  const ended = tasks.filter((t) => isFinished(t.status));
  // 默认类型归档了：不生效，也不显示（组上存的 id 不动，取消归档后又生效）
  const defType = store.get('task_type', store.effectiveDefaultTypeId(g));
  return (
    <div className="page">
      <PageHeader
        title={g.name}
        icon={<span className="page-emoji">{g.icon}</span>}
        subtitle={
          <>
            {range(g)}
            {c && <> · {c.name}</>}
            {defType && <> {tr(' · 默认类型：{name}', { name: dataLabel(defType.name) })}</>}
          </>
        }
        actions={
          <Button variant="primary" onPress={() => ui.openQuickCreate({ group_id: g.id })}>
            <Plus size={16} />
            {tr('新建任务')}</Button>
        }
      />
      <div className="filter-row">
        <Segmented
          label={tr('视图')}
          value={view}
          onChange={setView}
          options={[
            { id: 'list', label: <><List size={14} /> {tr('列表')}</> },
            { id: 'cards', label: <><LayoutGrid size={14} /> {tr('卡片')}</> },
            { id: 'graph', label: <><Network size={14} /> {tr('关系图')}</> },
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
            {!open.length && <Empty title={tr('组里的任务都做完了')} />}
          </div>
          {ended.length > 0 && (
            <Section title={tr('已结束 {length}', { length: ended.length })}>
              <div className="task-list plain">
                {ended.map((t) => (
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
