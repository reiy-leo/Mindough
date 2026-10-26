import { useState } from 'react';
import { Button as RacButton } from 'react-aria-components';
import { CalendarRange, Plus, Shapes } from 'lucide-react';
import { formatDateZh, isFinished, toDateKey, type Group, type Task } from '@mindough/core';
import { useStore } from '../store/StoreProvider';
import { navigate } from '../lib/router';
import { Button, Chip, Empty, Field, ProgressBar, Section, Segmented, Select, Sheet } from '../ui/primitives';
import { TaskRow } from '../components/TaskRow';
import { PageHeader } from '../components/PageHeader';
import { QuickAddBar } from '../components/QuickAddBar';
import { ProjectBoard } from '../components/project/ProjectBoard';
import { ProjectTimeline } from '../components/project/ProjectTimeline';
import { ProjectChains } from '../components/project/ProjectChains';
import { SortMenu, ViewMenu } from '../components/project/ProjectMenus';
import { useSettings } from '../lib/settings';
import { normalizePrefs, sortTasks, type ProjectViewPrefs } from '../lib/project-view';

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
      title={tr('新建项目')}
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
        title={trc('导航', '项目')}
        subtitle={tr('一批相关的任务，有起止时间和分类')}
        icon={<Shapes size={22} />}
        actions={
          <Button variant="primary" onPress={() => setCreating(true)}>
            <Plus size={16} />
            {tr('新建项目')}</Button>
        }
      />
      <div className="filter-row">
        <Segmented label={tr('按分类筛选')} value={cat} onChange={setCat} options={[{ id: 'all', label: tr('全部') }, ...categories.map((c) => ({ id: c.id, label: c.name }))]} />
      </div>
      {groups.length === 0 ? (
        <Empty title={tr('还没有项目')} hint={tr('项目用来装一批相关任务，比如“搬家”“开发某个功能”')} />
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

/**
 * 单个项目的任务页（Rei 2026-10-26：「每个项目的视图支持列表、看板、时间轴，排序支持创建时间、修改时间、开始时间、到期时间，正序、倒序。
 * 视图和排序放在右上角图标按钮，点击dropdown。新建任务也统一换成输入框。标题和图标左上角，小一点，和右侧图标对齐」；
 * 同日「关系图完全去掉」「添加另外一个视图：任务链」「把项目中的任务关系按照任务链排列」）。
 * 视图、排序每个项目单独记在本机设置（settings.projectViews，不同步）；逻辑见 lib/project-view。
 */
export function GroupDetailPage({ id }: { id: string }) {
  const store = useStore();
  const { settings, set } = useSettings();
  const prefs = normalizePrefs(settings.projectViews[id]);
  const setPrefs = (patch: Partial<ProjectViewPrefs>) => set('projectViews', { ...settings.projectViews, [id]: { ...prefs, ...patch } });
  const g = store.get('group', id);
  if (!g) return <Empty title={tr('找不到这个项目')} hint={tr('可能已经删除了')} />;
  const tasks: Task[] = sortTasks(
    store.tasks().filter((t) => t.group_id === id),
    prefs.sort,
    prefs.dir,
  );
  const c = store.get('category', g.category_id);
  const open = tasks.filter((t) => !isFinished(t.status));
  const ended = tasks.filter((t) => isFinished(t.status));
  // 默认类型归档了照样生效、照常显示（Rei 2026-10-17）
  const defType = store.get('task_type', store.effectiveDefaultTypeId(g));
  // 回车建到本项目（带项目的默认类型），马上打开；看板里新任务是「待办」，自然在待办列
  const create = (text: string) => store.createTask({ body_md: text, group_id: g.id }).id;
  return (
    <div className={`page project-page is-${prefs.view}`}>
      <PageHeader
        compact
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
          <>
            <ViewMenu view={prefs.view} onChange={(view) => setPrefs({ view })} />
            <SortMenu field={prefs.sort} dir={prefs.dir} onChange={(sort, dir) => setPrefs({ sort, dir })} />
          </>
        }
      />
      <QuickAddBar label={tr('添加任务到这个项目')} placeholder={tr('这个项目里要做什么？按回车添加')} create={create} />
      {prefs.view === 'board' ? (
        <ProjectBoard store={store} tasks={tasks} />
      ) : prefs.view === 'timeline' ? (
        <ProjectTimeline store={store} tasks={tasks} scale={prefs.scale} onScale={(scale) => setPrefs({ scale })} />
      ) : prefs.view === 'chain' ? (
        <ProjectChains store={store} groupId={g.id} tasks={tasks} />
      ) : (
        <>
          <div className="task-list plain">
            {open.map((t) => (
              <TaskRow key={t.id} store={store} task={t} showGroup={false} showDate />
            ))}
            {!open.length && <Empty title={tr('项目里的任务都做完了')} />}
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
