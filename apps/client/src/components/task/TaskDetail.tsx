import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { Autocomplete, Button as RacButton, Disclosure, DisclosurePanel, Heading, Input, ListBox, ListBoxItem, SearchField, useFilter } from 'react-aria-components';
import { AlertTriangle, CalendarDays, CornerLeftUp, CornerRightDown, Network, Check, ChevronDown, ChevronRight, CircleHelp, CircleSlash, Link2, ListPlus, Pause, Play, Plus, Repeat, RotateCcw, Search, Shapes, Square, Sun, SunDim, Tag, Trash2, Users, X } from 'lucide-react';
import {
  PLAIN_TYPE_ID,
  countdownPhrase,
  findEpisode,
  firstLine,
  formatEpisode,
  describeCompletion,
  describeRecurrence,
  formatDuration,
  formatTarget,
  friendlyDate,
  isFinished,
  parseRecurrence,
  predecessorsOf,
  successorsOf,
  taskStreak,
  hasLibrary,
  isPersonLibrary,
  libraryCopy,
  taskFieldsOf,
  toDateKey,
  type LibraryEntry,
  type Store,
  type Task,
  type TaskType,
} from '@mindough/core';
import { navigate } from '../../lib/router';
import { ItemCard, ItemSheet, LibraryPicker } from '../library/Library';
import { useNow, useStore } from '../../store/StoreProvider';
import { useUi } from '../../lib/ui';
import { useSettings } from '../../lib/settings';
import { announceComplete, closeTask, toggleMyDay, tryAddDependency, tryLinkTasks } from '../../lib/actions';
import { TaskSearch, taskStateText } from './TaskSearch';
import { imageUrl, titleOf } from '../../lib/view';
import { typeIcon } from '../../lib/icons';
import { AutoTextarea, Button, ConfirmDialog, OverflowMenu, PopoverPanel, ProgressRing, Sheet, Tip, type MenuAction } from '../../ui/primitives';
import { Markdown } from '../Markdown';
import { AvatarStack } from '../Avatar';
import { CategoryLabel, CategoryPicker } from '../CheckInCategory';
import { CompletionChoice, CompletionSentence, GroupList, MODE_ICON, PeopleList, RepeatEditor, TypeFields, TypeGrid, modeDefaults } from './pickers';
import { DatePanel } from './DatePanel';
import { MARKDOWN_HELP } from './TaskComposer';

export function TaskDetail() {
  const ui = useUi();
  const store = useStore();
  const task = store.get('task', ui.editingId);
  if (!task) return null;
  return <Detail key={task.id} task={task} />;
}

/** 正文：平时是排好版的 markdown，点一下变成可编辑；离开或按 Esc 保存。 */
function Body({ store, task, placeholder }: { store: Store; task: Task; placeholder: string }) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(task.body_md);
  const latest = useRef(body);
  latest.current = body;
  useEffect(() => {
    if (!editing) setBody(task.body_md);
  }, [task.body_md, editing]);
  // 关掉面板时还在编辑：也要存下来
  useEffect(
    () => () => {
      const cur = store.get('task', task.id);
      if (cur && latest.current !== cur.body_md) store.updateTask(task.id, { body_md: latest.current });
    },
    [store, task.id],
  );
  const ui = useUi();
  const commit = () => {
    if (body !== task.body_md) {
      store.updateTask(task.id, { body_md: body });
      // 看到哪还空着、第一行写了 S02E03 / 第二季第三集：顺手填上，提示里可以撤销
      const type = store.get('task_type', task.type_id);
      const ep = type?.fields.find((f) => f.kind === 'episode' && f.scope === 'task');
      const cur = store.get('task', task.id);
      const m = ep && cur && (cur.type_data[ep.key] === undefined || cur.type_data[ep.key] === null || cur.type_data[ep.key] === '') ? findEpisode(firstLine(body)) : null;
      if (ep && cur && m) {
        store.updateTask(task.id, { type_data: { ...cur.type_data, [ep.key]: m.value } });
        ui.toast(
          {
            message: `已识别 ${formatEpisode(m.value)}，填进了「${ep.label}」`,
            actions: [
              {
                label: '撤销',
                onPress: () => {
                  const t = store.get('task', task.id);
                  if (!t) return;
                  const td = { ...t.type_data };
                  delete td[ep.key];
                  store.updateTask(task.id, { type_data: td });
                },
              },
            ],
          },
          5000,
        );
      }
    }
    setEditing(false);
  };
  if (editing)
    return (
      <div className="detail-body is-editing">
        <AutoTextarea
          label="内容"
          className="detail-textarea"
          value={body}
          onChange={setBody}
          onBlur={commit}
          autoFocus
          minRows={3}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              e.preventDefault();
              commit();
            }
          }}
        />
        <div className="detail-body-help">
          <Tip content={MARKDOWN_HELP}>
            <RacButton className="link-btn">写法提示</RacButton>
          </Tip>
          <span>按 Esc 收起</span>
        </div>
      </div>
    );
  const open = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('a, input, button')) return;
    setEditing(true);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && e.target === e.currentTarget) {
      e.preventDefault();
      setEditing(true);
    }
  };
  return (
    <div className="detail-body" tabIndex={0} role="group" aria-label="内容，按回车编辑" onClick={open} onKeyDown={onKey}>
      {task.body_md.trim() ? <Markdown source={task.body_md} className="detail-md" /> : <div className="detail-placeholder">{placeholder}</div>}
    </div>
  );
}

interface Act {
  label: string;
  icon?: ReactNode;
  onPress: () => void;
  disabled?: boolean;
}

/** 现在该做的事：完成 / 开始计时 / +1 …（一个主操作；计时进行中多一个暂停）。 */
function useActions(store: Store, task: Task, done: () => void) {
  const ui = useUi();
  const running = store.progress(task.id)?.running ?? false;
  const now = useNow(running ? 1000 : 30_000);
  const today = toDateKey(now);
  const p = store.progress(task.id, today);
  const recurring = !!task.recurrence;
  const record = (kind: Parameters<Store['checkIn']>[1], amount = 0) => {
    const prev = task.status;
    const r = store.checkIn(task.id, kind, amount, today);
    if (r.completed) {
      announceComplete(store, ui, r.completed, prev);
      done();
    } else if (r.progress.met && recurring && (kind === 'add' || kind === 'stop')) ui.toast({ tone: 'success', message: '今天的打卡完成了' }, 2500);
  };
  const complete = () => {
    const prev = task.status;
    announceComplete(store, ui, store.completeTask(task.id), prev);
    done();
  };
  let primary: Act | null = null;
  let secondary: Act | null = null;
  if (!isFinished(task.status) && p) {
    switch (task.completion_mode) {
      case 'once':
        primary = recurring
          ? p.met
            ? { label: '今天已打卡', icon: <Check size={16} />, onPress: () => {}, disabled: true }
            : { label: '打卡', icon: <Check size={16} />, onPress: () => record('add', 1) }
          : { label: '完成', icon: <Check size={16} />, onPress: complete };
        break;
      case 'timer':
        if (p.running) {
          secondary = { label: '暂停', icon: <Pause size={16} />, onPress: () => record('pause') };
          primary = { label: '结束', icon: <Square size={14} />, onPress: () => record('stop') };
        } else if (p.paused) {
          secondary = { label: '结束', icon: <Square size={14} />, onPress: () => record('stop') };
          primary = { label: '继续计时', icon: <Play size={16} />, onPress: () => record('resume') };
        } else if (p.met) primary = { label: recurring ? '今天已达标' : '已达标', icon: <Check size={16} />, onPress: () => {}, disabled: true };
        else primary = { label: '开始计时', icon: <Play size={16} />, onPress: () => record('start') };
        break;
      case 'count':
        primary = { label: `+1${task.unit ? ` ${task.unit}` : ''}`, icon: <Plus size={16} />, onPress: () => record('add', 1) };
        break;
      case 'countdown':
        primary = recurring ? { label: '打卡', icon: <Check size={16} />, onPress: () => record('stop'), disabled: p.met } : { label: '完成', icon: <Check size={16} />, onPress: complete };
        break;
    }
  }
  return { primary, secondary, today, complete };
}

function Progress({ store, task, today }: { store: Store; task: Task; today: string }) {
  const p = store.progress(task.id, today);
  const recurring = !!task.recurrence;
  if (!p || (task.completion_mode === 'once' && !recurring)) return null;
  const streak = recurring ? (taskStreak(task, store.checkInsOf(task.id), store.now())?.current ?? 0) : 0;
  let main: ReactNode = null;
  let sub: ReactNode = null;
  switch (task.completion_mode) {
    case 'once':
      main = p.met ? '今天已打卡' : '今天还没打卡';
      break;
    case 'timer':
      main = p.value > 0 || p.running ? formatDuration(p.value) : '还没开始';
      sub = p.target ? `目标 ${formatTarget(p.target)}` : '不限时长';
      break;
    case 'count':
      main = (
        <>
          {p.value}
          <span className="progress-of"> / {p.target ?? 1}</span>
          {task.unit && <span className="progress-unit"> {task.unit}</span>}
        </>
      );
      sub = p.met ? '已达标' : `还差 ${Math.max(0, (p.target ?? 1) - p.value)} ${task.unit ?? '次'}`;
      break;
    case 'countdown':
      main = countdownPhrase(task.target_date, today);
      sub = task.target_date ? friendlyDate(task.target_date, today) : null;
      break;
  }
  return (
    <div className={`progress-panel${p.running ? ' is-running' : ''}`}>
      {(task.completion_mode === 'timer' || task.completion_mode === 'count') && <ProgressRing value={p.ratio} size={44} stroke={4} />}
      <div className="progress-text">
        <div className="progress-main">{main}</div>
        {(sub || recurring) && (
          <div className="progress-sub">
            {recurring && task.completion_mode !== 'once' && <span>今天</span>}
            {sub && <span>{sub}</span>}
            {recurring && streak > 0 && <span>已连续 {streak} 次</span>}
          </div>
        )}
      </div>
    </div>
  );
}

/** 属性列表的一行：标签 + 值，点值弹出编辑。 */
function PropRow({ icon, label, value, empty, children, wide }: { icon: ReactNode; label: string; value: ReactNode; empty?: boolean; children: ReactNode | ((close: () => void) => ReactNode); wide?: boolean }) {
  return (
    <div className="prop-row">
      <span className="prop-label">
        {icon}
        {label}
      </span>
      <PopoverPanel
        label={label}
        placement="bottom end"
        {...(wide ? { className: 'is-wide' } : {})}
        trigger={
          <RacButton className={`prop-value${empty ? ' is-empty' : ''}`} {...(typeof value === 'string' ? { 'aria-label': `${label}：${value}` } : {})}>
            <span className="prop-value-text">{value}</span>
            <ChevronDown size={14} aria-hidden className="prop-caret" />
          </RacButton>
        }
      >
        {children}
      </PopoverPanel>
    </div>
  );
}

type RelKind = 'pred' | 'succ' | 'related';

/** 三种关系的叫法（菜单、分组标题、挑任务的弹层标题共用，见 COPY.md）。 */
const REL_LABEL: Record<RelKind, string> = { pred: '先做完这些', succ: '做完后解锁', related: '相关任务' };

/** 「添加关系」菜单：三种关系各一项，选了打开挑任务的弹层。 */
function RelationMenu({ onPick, className }: { onPick: (k: RelKind) => void; className?: string }) {
  const items: MenuAction[] = [
    { id: 'pred', label: `${REL_LABEL.pred}…`, icon: <CornerLeftUp size={16} />, onAction: () => onPick('pred') },
    { id: 'succ', label: `${REL_LABEL.succ}…`, icon: <CornerRightDown size={16} />, onAction: () => onPick('succ') },
    { id: 'related', label: `${REL_LABEL.related}…`, icon: <Link2 size={16} />, onAction: () => onPick('related') },
  ];
  return <OverflowMenu label="添加关系" icon={<Network size={17} />} items={items} {...(className ? { className } : {})} />;
}

/** 挑一件任务连上这种关系；搜不到就「新建“xxx”」，新建的任务直接连好（合并了以前的「添加」和「新建下一步」）。 */
function RelationPicker({ store, task, kind, onClose }: { store: Store; task: Task; kind: RelKind | null; onClose: () => void }) {
  const ui = useUi();
  if (!kind) return null;
  const edges = store.edges();
  const exclude = new Set([task.id, ...predecessorsOf(edges, task.id), ...successorsOf(edges, task.id), ...store.relatedTasks(task.id).map((t) => t.id)]);
  const connect = (id: string) => {
    if (kind === 'pred') tryAddDependency(store, ui, id, task.id);
    else if (kind === 'succ') tryAddDependency(store, ui, task.id, id);
    else tryLinkTasks(store, ui, task.id, id);
  };
  const hint = kind === 'pred' ? '这些做完了，才能开始这件。' : kind === 'succ' ? '这件做完了，它们就能开始。' : '只是有关系，不分先后：不用等它，也不会解锁它。';
  return (
    <Sheet isOpen onOpenChange={(o) => !o && onClose()} title={REL_LABEL[kind]} className="modal-relpick">
      <p className="rel-pick-hint">{hint}</p>
      <TaskSearch
        store={store}
        exclude={exclude}
        label="搜索任务，或写下新的一件"
        onPick={(id) => {
          connect(id);
          onClose();
        }}
        onCreate={(text) => {
          const created = store.createTask({ body_md: text, group_id: task.group_id });
          connect(created.id);
          ui.toast({ message: `已新建「${text}」`, actions: [{ label: '查看', onPress: () => ui.openEditor(created.id) }] });
          onClose();
        }}
      />
    </Sheet>
  );
}

/**
 * 详情的「关系」（Rei 2026-10-16：「关联占用那么大空间……如果这类关系中没有内容，则不显示」）：
 * 只显示有内容的分组；三组都空时整个分区不显示。添加一律走顶栏的「添加关系」（三种关系的菜单）。分组里不再有「添加」「新建下一步」。
 */
function Relations({ store, task }: { store: Store; task: Task }) {
  const ui = useUi();
  const edges = store.edges();
  const preds = predecessorsOf(edges, task.id).map((id) => store.get('task', id)).filter((t): t is Task => !!t);
  const succs = successorsOf(edges, task.id).map((id) => store.get('task', id)).filter((t): t is Task => !!t);
  const related = store.relatedTasks(task.id);
  const title = (t: Task) => titleOf(store, t);
  const derived = store.derived().get(task.id);
  // 同步合并后绕成圈、暂不生效的前后关系（两台设备各连了一条）
  const conflicts = store.conflictEdges().filter((e) => e.pred_id === task.id || e.succ_id === task.id);
  if (!preds.length && !succs.length && !related.length && !conflicts.length) return null;
  const row = (t: Task, dir: RelKind) => {
    const state = t.status === '完成' ? 'done' : t.status === '关闭' ? 'closed' : 'open';
    const meta = taskStateText(store, t);
    const remove = () => (dir === 'pred' ? store.removeDependency(t.id, task.id) : dir === 'succ' ? store.removeDependency(task.id, t.id) : store.unlinkTasks(task.id, t.id));
    return (
      <li key={t.id} className={`rel-item is-${state}${dir === 'related' ? ' is-related' : ''}`}>
        <span className="rel-dot" aria-label={state === 'done' ? '已完成' : state === 'closed' ? '已关闭' : '未完成'}>
          {state === 'done' ? <Check size={11} strokeWidth={3} /> : state === 'closed' ? <X size={11} strokeWidth={3} /> : dir === 'related' ? <Link2 size={10} strokeWidth={2.5} /> : null}
        </span>
        <RacButton className="rel-title" onPress={() => ui.openEditor(t.id)}>
          {title(t)}
        </RacButton>
        {meta && state === 'open' && <span className="rel-meta">{meta}</span>}
        <RacButton className="icon-btn rel-remove" aria-label={dir === 'related' ? `不再和「${title(t)}」相关` : `去掉和「${title(t)}」的关系`} onPress={remove}>
          <X size={14} />
        </RacButton>
      </li>
    );
  };
  const group = (kind: RelKind, list: Task[], extra?: ReactNode) =>
    list.length ? (
      <div className="rel-group">
        <div className="rel-head">
          <span>{REL_LABEL[kind]}</span>
          {extra}
        </div>
        <ul className="rel-list">{list.map((t) => row(t, kind))}</ul>
      </div>
    ) : null;
  return (
    <section className="relations" aria-label="关系">
      <h3 className="detail-section-title">关系</h3>
      {conflicts.map((e) => {
        const a = store.get('task', e.pred_id);
        const b = store.get('task', e.succ_id);
        if (!a || !b) return null;
        return (
          <div key={`${e.pred_id}>${e.succ_id}`} className="rel-conflict" role="alert">
            <AlertTriangle size={16} aria-hidden />
            <div className="grow">
              <div className="rel-conflict-title">先后关系绕成了圈</div>
              <div className="rel-conflict-text">
                在两台设备上分别连的前后关系合在一起，绕成了圈：「{title(a)}」做完才能开始「{title(b)}」这一条暂时不生效。去掉其中一条就好。
              </div>
            </div>
            <RacButton className="link-btn" onPress={() => store.removeDependency(e.pred_id, e.succ_id)}>
              去掉这条
            </RacButton>
          </div>
        );
      })}
      {group('pred', preds, derived?.state === '被阻塞' ? <span className="rel-count">还差 {derived.missing.length} 件</span> : null)}
      {group('succ', succs)}
      {group(
        'related',
        related,
        <Tip content="只是有关系，不分先后：不用等它，也不会解锁它">
          <RacButton className="icon-btn rel-hint" aria-label="相关任务是什么">
            <CircleHelp size={13} aria-hidden />
          </RacButton>
        </Tip>,
      )}
    </section>
  );
}

/**
 * 资料卡：这件任务用的是库里的哪一条（海报 + 名字 + 简介），可以「换一个」或「编辑资料」。
 * 资料改了，用到它的任务都会变（编辑弹层里会轻轻提一句）。
 */
function LibraryHero({ store, type, task }: { store: Store; type: TaskType; task: Task }) {
  const ui = useUi();
  const person = isPersonLibrary(type);
  const key = type.fields.find((f) => f.primary)!.key;
  const entryId = person ? (typeof task.type_data[key] === 'string' ? (task.type_data[key] as string) : null) : task.library_item_id;
  const entry = entryId ? store.libraryEntries(type.id).find((e) => e.id === entryId) : undefined;
  const copy = libraryCopy(type);
  const [query, setQuery] = useState('');
  const [sheet, setSheet] = useState<null | { edit: true } | { create: string }>(null);
  const attach = (id: string) => {
    if (person) store.updateTask(task.id, { type_data: { ...task.type_data, [key]: id } });
    else store.setTaskItem(task.id, id);
  };
  const picker = (close: () => void) => (
    <LibraryPicker
      store={store}
      type={type}
      query={query}
      onQueryChange={setQuery}
      exclude={entryId}
      autoFocus
      className="in-popover"
      onPick={(e: LibraryEntry) => {
        attach(e.id);
        setQuery('');
        close();
      }}
      onCreate={(name) => {
        close();
        setQuery('');
        setSheet({ create: name });
      }}
    />
  );
  const open = () => {
    if (!entryId) return;
    ui.openEditor(null);
    navigate(person ? { page: 'person', id: entryId } : { page: 'libitem', typeId: type.id, id: entryId });
  };
  return (
    <>
      {entry ? (
        <ItemCard
          store={store}
          type={type}
          size="lg"
          entry={entry}
          actions={
            <>
              <PopoverPanel
                label="换一个"
                placement="bottom end"
                className="is-wide"
                trigger={<RacButton className="btn btn-secondary btn-sm">换一个</RacButton>}
              >
                {picker}
              </PopoverPanel>
              <Button variant="secondary" className="btn-sm" onPress={() => setSheet({ edit: true })}>
                编辑资料
              </Button>
              <RacButton className="link-btn item-card-open" onPress={open}>
                在{copy.name}里看
                {entry.uses > 1 ? ` · ${entry.uses} 件任务` : ''}
                <ChevronRight size={13} aria-hidden />
              </RacButton>
            </>
          }
        />
      ) : (
        <PopoverPanel
          label={copy.pick}
          className="is-wide"
          trigger={
            <RacButton className="item-card-empty" style={{ '--chip-color': type.color } as CSSProperties}>
              <Search size={16} aria-hidden />
              {copy.pick}
            </RacButton>
          }
        >
          {picker}
        </PopoverPanel>
      )}
      {sheet && (
        <ItemSheet
          store={store}
          type={type}
          {...('edit' in sheet ? { itemId: entryId } : { initialName: sheet.create })}
          onClose={() => setSheet(null)}
          onSaved={(id) => {
            if (!('edit' in sheet)) attach(id);
          }}
        />
      )}
    </>
  );
}

function Detail({ task }: { task: Task }) {
  const ui = useUi();
  const store = useStore();
  const { layout } = useSettings();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [addRel, setAddRel] = useState<RelKind | null>(null);
  const close = () => ui.openEditor(null);
  const { primary, secondary, today, complete } = useActions(store, task, close);
  const type = store.get('task_type', task.type_id);
  const typed = !!type && type.id !== PLAIN_TYPE_ID && type.fields.length > 0;
  const title = titleOf(store, task);
  const lib = hasLibrary(type) ? type : null;
  const taskFields = lib ? taskFieldsOf(lib) : [];
  const patch = (p: Partial<Task>) => store.updateTask(task.id, p);
  const types = store.list('task_type').filter((t) => !t.hidden).sort((a, b) => a.sort - b.sort);
  const group = store.get('group', task.group_id);
  const linked = store.list('task_person').filter((x) => x.task_id === task.id).map((x) => x.person_id);
  const people = linked.map((id) => store.get('person', id)).filter((p): p is NonNullable<typeof p> => !!p);
  const inDay = store.isInMyDay(task.id, today);
  const finished = isFinished(task.status);
  const recurring = !!task.recurrence;
  const derived = store.derived().get(task.id);
  const cat = task.checkin_category_id ? store.get('checkin_category', task.checkin_category_id) : undefined;
  const mediaKey = type?.fields.find((f) => f.media)?.key;
  const media = typed && mediaKey ? imageUrl(store, task.type_data[mediaKey]) : null;
  const primaryDef = type?.fields.find((f) => f.primary);
  const hasPrimary = !!primaryDef && !!task.type_data[primaryDef.key];
  const TypeIcon = typeIcon(type?.icon ?? 'file-text');
  const ModeIcon = MODE_ICON[task.completion_mode];

  let badge: ReactNode = null;
  if (task.status === '完成')
    badge = (
      <span className="status-badge is-done">
        <Check size={12} strokeWidth={3} />
        已完成
      </span>
    );
  else if (task.status === '关闭')
    badge = (
      <span className="status-badge is-closed">
        <CircleSlash size={12} />
        已关闭
      </span>
    );
  else if (derived?.state === '被阻塞') badge = <span className="status-badge is-blocked">还在等 {derived.missing.length} 件事</span>;
  else if (task.status === '进行中') badge = <span className="status-badge is-active">进行中</span>;

  const menu: MenuAction[] = [
    { id: 'myday', label: inDay ? '移出我的一天' : '加入我的一天', icon: inDay ? <SunDim size={16} /> : <Sun size={16} />, onAction: () => toggleMyDay(store, ui, task.id) },
    ...(!finished && !recurring && task.completion_mode !== 'once' ? [{ id: 'done', label: '直接标为完成', icon: <Check size={16} />, onAction: complete }] : []),
    { id: 'delete', label: '删除…', icon: <Trash2 size={16} />, danger: true, onAction: () => setConfirmDelete(true) },
  ];

  const props = (
    <div className="prop-list" role="group" aria-label="属性">
      <PropRow icon={<TypeIcon size={15} />} label="类型" value={type && type.id !== PLAIN_TYPE_ID ? type.name : '普通'}>
        {(c) => (
          <div className="pop-section">
            <TypeGrid
              types={types}
              value={task.type_id ?? PLAIN_TYPE_ID}
              onChange={(id) => {
                // 改类型时保留已填字段（资料抄回任务，新类型没有的先藏起来不删）；正文为空时套用模板
                store.changeTaskType(task.id, id);
                c();
              }}
            />
          </div>
        )}
      </PropRow>
      <PropRow icon={<ModeIcon size={15} />} label="完成方式" value={describeCompletion(task, today)} wide>
        <div className="pop-section">
          <CompletionChoice compact value={task.completion_mode} onChange={(m) => patch(modeDefaults(m, task))} />
          <CompletionSentence value={task} today={today} onChange={(p) => patch(p)} />
        </div>
      </PropRow>
      <PropRow icon={<Repeat size={15} />} label="重复" value={describeRecurrence(parseRecurrence(task.recurrence))} empty={!recurring} wide>
        <div className="pop-section">
          <RepeatEditor value={task.recurrence} today={today} onChange={(r) => patch({ recurrence: r })} />
        </div>
      </PropRow>
      {recurring && (
        <PropRow icon={<Tag size={15} />} label="打卡分类" value={cat ? <CategoryLabel c={cat} /> : '未分类'} empty={!cat} wide>
          {(c) => (
            <div className="pop-section">
              <CategoryPicker
                store={store}
                value={task.checkin_category_id}
                onChange={(id) => {
                  patch({ checkin_category_id: id });
                  c();
                }}
              />
            </div>
          )}
        </PropRow>
      )}
      {/* 定期打卡的任务按重复规则出现，不需要单独的日期 */}
      {!recurring && (
        <PropRow icon={<CalendarDays size={15} />} label="日期" value={task.scheduled_date ? friendlyDate(task.scheduled_date, today) : '未安排'} empty={!task.scheduled_date}>
          {(c) => (
            <DatePanel
              value={task.scheduled_date}
              today={today}
              onChange={(v) => {
                patch({ scheduled_date: v });
                c();
              }}
            />
          )}
        </PropRow>
      )}
      <PropRow icon={<Shapes size={15} />} label="组" value={group ? `${group.icon} ${group.name}` : '不放进组'} empty={!group}>
        {(c) => (
          <GroupList
            store={store}
            value={task.group_id}
            onChange={(id) => {
              patch({ group_id: id });
              c();
            }}
          />
        )}
      </PropRow>
      <PropRow
        icon={<Users size={15} />}
        label="和谁有关"
        value={
          people.length ? (
            <span className="prop-people">
              <AvatarStack store={store} people={people} size={18} />
              {people.map((p) => p.name).join('、')}
            </span>
          ) : (
            '没有'
          )
        }
        empty={!people.length}
      >
        <PeopleList
          store={store}
          value={linked}
          onChange={(ids) => {
            const next = new Set(ids);
            for (const id of linked) if (!next.has(id)) store.unlinkPerson(task.id, id);
            for (const id of ids) if (!linked.includes(id)) store.linkPerson(task.id, id);
          }}
        />
      </PropRow>
    </div>
  );

  return (
    <>
      <Sheet
        isOpen
        wide
        className={`modal-detail${finished ? ' is-finished' : ''}`}
        onOpenChange={(o) => !o && close()}
        title={title}
        titleHidden
        headerStart={badge}
        headerEnd={
          <>
            <Tip content={inDay ? '移出我的一天' : '加入我的一天'}>
              <RacButton className={`icon-btn myday-toggle${inDay ? ' is-on' : ''}`} aria-label={inDay ? '移出我的一天' : '加入我的一天'} aria-pressed={inDay} onPress={() => toggleMyDay(store, ui, task.id)}>
                <Sun size={18} />
              </RacButton>
            </Tip>
            <RelationMenu onPick={setAddRel} />
            <OverflowMenu items={menu} />
          </>
        }
        footer={
          finished ? (
            <>
              <span className="foot-note">{task.status === '完成' ? '这件事已经做完了。' : '这件事已关闭，不用再做了。'}</span>
              <span className="grow" />
              <Button
                variant="secondary"
                onPress={() => {
                  store.reopenTask(task.id);
                  ui.toast({ message: '已重新打开' }, 2500);
                }}
              >
                <RotateCcw size={16} />
                {recurring ? '恢复打卡' : '重新打开'}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="quiet"
                className="close-task"
                onPress={() => {
                  closeTask(store, ui, task.id);
                  close();
                }}
              >
                <CircleSlash size={16} />
                {recurring ? '不再打卡' : '关闭'}
              </Button>
              <span className="grow" />
              {secondary && (
                <Button variant="secondary" onPress={secondary.onPress}>
                  {secondary.icon}
                  {secondary.label}
                </Button>
              )}
              {primary && (
                <Button variant="primary" className="primary-action" onPress={primary.onPress} isDisabled={!!primary.disabled}>
                  {primary.icon}
                  {primary.label}
                </Button>
              )}
            </>
          )
        }
      >
        <div className={`detail${layout === 'mobile' ? ' is-mobile' : ''}`}>
          <div className="detail-main">
            {lib && <LibraryHero store={store} type={lib} task={task} />}
            {!lib && typed && type && (
              <div className="detail-hero" style={{ '--chip-color': type.color } as CSSProperties}>
                {media ? (
                  <img className={`hero-media layout-${type.layout}`} src={media} alt="" />
                ) : (
                  <span className="hero-icon">
                    <TypeIcon size={22} />
                  </span>
                )}
                <div className="hero-text">
                  <Heading level={2} className="hero-title">
                    {hasPrimary ? title : <span className="muted">还没填{primaryDef?.label}</span>}
                  </Heading>
                  <div className="hero-sub">{type.name}</div>
                </div>
              </div>
            )}
            <Body store={store} task={task} placeholder={typed ? '添加笔记…' : '写点什么…'} />
            <Progress store={store} task={task} today={today} />
            {lib && taskFields.length > 0 && (
              <div className="detail-taskfields">
                <TypeFields bare store={store} type={{ ...lib, fields: taskFields }} data={task.type_data} onChange={(k, v) => patch({ type_data: { ...task.type_data, [k]: v } })} />
              </div>
            )}
            {!lib && typed && type && (
              <Disclosure className="type-disclosure" defaultExpanded={!hasPrimary}>
                <Heading level={3} className="disclosure-head">
                  <RacButton slot="trigger" className="disclosure-trigger">
                    <ChevronRight size={14} className="disclosure-chevron" aria-hidden />
                    {type.name}信息
                  </RacButton>
                </Heading>
                <DisclosurePanel>
                  <TypeFields bare store={store} type={type} data={task.type_data} onChange={(k, v) => patch({ type_data: { ...task.type_data, [k]: v } })} />
                </DisclosurePanel>
              </Disclosure>
            )}
            {layout === 'mobile' && props}
            <Relations store={store} task={task} />
          </div>
          {layout !== 'mobile' && <aside className="detail-side">{props}</aside>}
        </div>
      </Sheet>
      <RelationPicker store={store} task={task} kind={addRel} onClose={() => setAddRel(null)} />
      <ConfirmDialog
        isOpen={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="删除这件任务？"
        message={<>「{title}」会被删除，它和别的任务之间的关系也一起去掉。删除后不能恢复。</>}
        confirmLabel="删除"
        danger
        onConfirm={() => {
          store.deleteTask(task.id);
          close();
          ui.toast({ message: '已删除' }, 2500);
        }}
      />
    </>
  );
}
