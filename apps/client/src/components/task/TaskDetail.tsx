import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type TouchEvent, type ReactNode, type RefObject } from 'react';
import { Autocomplete, Button as RacButton, Disclosure, DisclosurePanel, Heading, Input, ListBox, ListBoxItem, SearchField, useFilter } from 'react-aria-components';
import { AlertTriangle, ArrowLeft, ChevronLeft, Gauge, Hash, ListChecks, Tv, Type, CalendarDays, CornerLeftUp, CornerRightDown, Network, Check, ChevronDown, ChevronRight, CircleHelp, CircleSlash, Link2, ListPlus, Pause, Play, Plus, RotateCcw, Square, Sun, SunDim, Trash2, X } from 'lucide-react';
import {
  PLAIN_TYPE_ID,
  countdownPhrase,
  findEpisode,
  firstLine,
  formatEpisode,
  formatAmount,
  formatDuration,
  formatTarget,
  formatTaskDate,
  type DateDisplay,
  isFinished,
  predecessorsOf,
  successorsOf,
  taskStreak,
  hasLibrary,
  isPersonLibrary,
  libraryCopy,
  taskFieldsOf,
  toDateKey,
  type FieldDef,
  type FieldValue,
  type LibraryEntry,
  type Store,
  type Task,
  type TaskType,
} from '@mindough/core';
import { shownFields } from '@mindough/core';
import { navigate } from '../../lib/router';
import { ItemCard, ItemSheet, artShape, entryArt } from '../library/Library';
import { RefList, RefPicker } from '../library/RefPicker';
import { useNow, useStore } from '../../store/StoreProvider';
import { useUi } from '../../lib/ui';
import { useSettings } from '../../lib/settings';
import { useDateDisplay } from '../../lib/date-display';
import { announceComplete, closeTask, toggleMyDay, tryAddDependency, tryLinkTasks } from '../../lib/actions';
import { TaskSearch, taskStateText } from './TaskSearch';
import { imageUrl, titleOf } from '../../lib/view';
import { typeIcon } from '../../lib/icons';
import { AutoTextarea, Button, ConfirmDialog, OverflowMenu, PopoverPanel, ProgressRing, Sheet, Tip, type MenuAction } from '../../ui/primitives';
import { Markdown } from '../Markdown';
import { FieldInput, MODE_ICON, TypeFields } from './pickers';
import { LazyMdEditor } from '../editor/LazyMdEditor';
import { detailMenu, type DetailMenuId } from '../../lib/task-menu';
import { Attachments, DropOverlay, useAddFiles, useFileDrop } from '../attachments/Attachments';
import { ChainToggle, TaskChainInline } from './TaskChain';
import { PropChips } from './PropChips';
import { CountNumber, CountQuickButtons, CountUndoButton, useCountAdd } from '../CountControls';

import { dataLabel, tr, trc } from '../../lib/i18n';
/**
 * 任务详情怎么摆（Rei 2026-10-23「任务链不要再弹窗了，任务详情如果不弹窗最好了，最好做成三列布局」）：
 * - pane：桌面 / 平板的右列（侧边栏 | 列表 | 详情），外框在 components/task/DetailPane.tsx；
 * - page：手机上整页推入（返回按钮、右滑、系统返回键回列表）；
 * - modal：桌面置顶小窗里还是弹窗（小窗太窄放不下第三列）。
 */
export type DetailMode = 'pane' | 'page' | 'modal';

export function TaskDetail({ mode = 'modal' }: { mode?: DetailMode }) {
  const ui = useUi();
  const store = useStore();
  const task = store.get('task', ui.editingId);
  if (!task) return null;
  return <Detail key={task.id} task={task} mode={mode} />;
}

/** 选中的任务还在不在（右列显示详情还是空状态）。 */
export function useSelectedTask(): Task | undefined {
  const ui = useUi();
  const store = useStore();
  return store.get('task', ui.editingId);
}

/**
 * 详情的外框：小窗里是弹窗（Sheet），右列和手机整页是普通的面板（顶栏 + 可滚动内容 + 底栏）。
 * 手机整页：左上「返回」，从屏幕左边缘往右滑也能返回（跟着手指走，松手过一段距离才回去）。
 */
function DetailFrame({
  mode,
  title,
  finished,
  onClose,
  headerStart,
  headerEnd,
  footer,
  children,
  frameRef,
  overlay,
}: {
  mode: DetailMode;
  title: string;
  finished: boolean;
  onClose: () => void;
  headerStart: ReactNode;
  headerEnd: ReactNode;
  footer: ReactNode;
  children: ReactNode;
  /** 右列 / 整页的外框（拖文件进来的范围是整列，Rei 2026-10-25）。弹窗不用它。 */
  frameRef?: RefObject<HTMLElement | null>;
  /** 盖在整列上的东西（拖放高亮层）。 */
  overlay?: ReactNode;
}) {
  const { skin } = useSettings();
  const ownRef = useRef<HTMLElement>(null);
  const pageRef = frameRef ?? ownRef;
  const swipe = useRef<{ x: number; y: number; dx: number; on: boolean } | null>(null);
  if (mode === 'modal')
    return (
      <Sheet isOpen wide className={`modal-detail${finished ? ' is-finished' : ''}`} onOpenChange={(o) => !o && onClose()} title={title} titleHidden headerStart={headerStart} headerEnd={headerEnd} footer={footer}>
        {children}
      </Sheet>
    );
  const page = mode === 'page';
  const setX = (dx: number, animate: boolean) => {
    const el = pageRef.current;
    if (!el) return;
    el.style.transition = animate ? 'transform 0.2s var(--ease)' : 'none';
    el.style.transform = dx ? `translateX(${dx}px)` : '';
  };
  const swipeProps = page
    ? {
        onTouchStart: (e: TouchEvent) => {
          const t = e.touches[0];
          // 只认从左边缘开始的（别和编辑器里选字、横向滚动的表格抢）
          swipe.current = t && t.clientX < 28 ? { x: t.clientX, y: t.clientY, dx: 0, on: false } : null;
        },
        onTouchMove: (e: TouchEvent) => {
          const s = swipe.current;
          const t = e.touches[0];
          if (!s || !t) return;
          const dx = t.clientX - s.x;
          if (!s.on && Math.abs(t.clientY - s.y) > Math.abs(dx)) {
            swipe.current = null;
            return;
          }
          s.on = dx > 8;
          s.dx = Math.max(0, dx);
          if (s.on) setX(s.dx, false);
        },
        onTouchEnd: () => {
          const s = swipe.current;
          swipe.current = null;
          if (!s?.on) return;
          if (s.dx > Math.min(120, window.innerWidth * 0.3)) {
            setX(window.innerWidth, true);
            window.setTimeout(onClose, 180);
          } else setX(0, true);
        },
      }
    : {};
  const BackIcon = skin === 'apple' ? ChevronLeft : ArrowLeft;
  return (
    <section ref={pageRef as RefObject<HTMLElement>} className={`pane-detail${page ? ' page-detail' : ''}${finished ? ' is-finished' : ''}`} aria-label={title} {...swipeProps}>
      {overlay}
      <div className="dialog-head pane-head" {...(page ? {} : { 'data-tauri-drag-region': true })}>
        {page && (
          <RacButton className="pane-back" aria-label={tr('返回')} onPress={onClose}>
            <BackIcon size={skin === 'apple' ? 24 : 20} aria-hidden />
            <span className="pane-back-label">{tr('返回')}</span>
          </RacButton>
        )}
        {headerStart}
        <h2 className="sr-only">{title}</h2>
        <span className="grow" />
        {headerEnd}
        {!page && (
          <Tip content={<>{tr('关闭')} <kbd className="kbd">Esc</kbd></>}>
            <RacButton className="icon-btn dialog-close" aria-label={tr('关闭')} onPress={onClose}>
              <X size={18} />
            </RacButton>
          </Tip>
        )}
      </div>
      <div className="dialog-body pane-body">{children}</div>
      {footer && <div className="dialog-foot pane-foot">{footer}</div>}
    </section>
  );
}

/**
 * 正文：所见即所得的 Markdown 编辑器（写的时候就是排好版的样子，存的还是 markdown）。
 * 打字先记在本地，离开编辑器、按 Esc 或关掉面板时存下来（同步一次一段，不是每个字一次）。
 */
function Body({ store, task, placeholder }: { store: Store; task: Task; placeholder: string }) {
  const [body, setBody] = useState(task.body_md);
  const latest = useRef(body);
  latest.current = body;
  const editing = useRef(false);
  useEffect(() => {
    // 别处（同步、撤销）改了正文，而这里没在写：跟上
    if (!editing.current) setBody(task.body_md);
  }, [task.body_md]);
  // 关掉面板时还没存：也要存下来
  useEffect(
    () => () => {
      const cur = store.get('task', task.id);
      if (cur && latest.current !== cur.body_md) store.updateTask(task.id, { body_md: latest.current });
    },
    [store, task.id],
  );
  const ui = useUi();
  const commit = () => {
    editing.current = false;
    const body = latest.current;
    if (body === task.body_md) return;
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
          message: tr('已识别 {formatEpisode}，填进了「{label}」', { formatEpisode: formatEpisode(m.value), label: dataLabel(ep.label) }),
          actions: [
            {
              label: tr('撤销'),
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
  };
  return (
    <div className="detail-body">
      <LazyMdEditor
        className="detail-md"
        label={tr('内容')}
        placeholder={placeholder}
        value={body}
        onChange={(v) => {
          editing.current = true;
          latest.current = v;
          setBody(v);
        }}
        onBlur={commit}
        onEscape={() => {
          commit();
          (document.activeElement as HTMLElement | null)?.blur();
        }}
      />
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
    } else if (r.progress.met && recurring && (kind === 'add' || kind === 'stop')) ui.toast({ tone: 'success', message: tr('今天的打卡完成了') }, 2500);
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
            ? { label: tr('今天已打卡'), icon: <Check size={16} />, onPress: () => {}, disabled: true }
            : { label: tr('打卡'), icon: <Check size={16} />, onPress: () => record('add', 1) }
          : { label: tr('完成'), icon: <Check size={16} />, onPress: complete };
        break;
      case 'timer':
        if (p.running) {
          secondary = { label: tr('暂停'), icon: <Pause size={16} />, onPress: () => record('pause') };
          primary = { label: tr('结束'), icon: <Square size={14} />, onPress: () => record('stop') };
        } else if (p.paused) {
          secondary = { label: tr('结束'), icon: <Square size={14} />, onPress: () => record('stop') };
          primary = { label: tr('继续计时'), icon: <Play size={16} />, onPress: () => record('resume') };
        } else if (p.met) primary = { label: recurring ? tr('今天已达标') : tr('已达标'), icon: <Check size={16} />, onPress: () => {}, disabled: true };
        else primary = { label: tr('开始计时'), icon: <Play size={16} />, onPress: () => record('start') };
        break;
      case 'count':
        // 计数不用单个主按钮：底栏和进度弹层放快捷加量（Rei 2026-10-26，CountQuickButtons）
        break;
      case 'countdown':
        primary = recurring ? { label: tr('打卡'), icon: <Check size={16} />, onPress: () => record('stop'), disabled: p.met } : { label: tr('完成'), icon: <Check size={16} />, onPress: complete };
        break;
    }
  }
  const addCount = useCountAdd(store, task, today, done);
  const counting = task.completion_mode === 'count' && !isFinished(task.status) && !!p;
  return { primary, secondary, today, complete, addCount, counting };
}

function Progress({ store, task, today, onCountInput }: { store: Store; task: Task; today: string; onCountInput?: (delta: number, how: 'add' | 'set') => void }) {
  const dateMode = useDateDisplay();
  const p = store.progress(task.id, today);
  const recurring = !!task.recurrence;
  if (!p || (task.completion_mode === 'once' && !recurring)) return null;
  const streak = recurring ? (taskStreak(task, store.checkInsOf(task.id), store.now())?.current ?? 0) : 0;
  let main: ReactNode = null;
  let sub: ReactNode = null;
  switch (task.completion_mode) {
    case 'once':
      main = p.met ? tr('今天已打卡') : tr('今天还没打卡');
      break;
    case 'timer':
      main = p.value > 0 || p.running ? formatDuration(p.value) : tr('还没开始');
      sub = p.target ? tr('目标 {formatTarget}', { formatTarget: formatTarget(p.target) }) : tr('不限时长');
      break;
    case 'count': {
      const nums = (
        <>
          {formatAmount(p.value)}
          <span className="progress-of"> / {formatAmount(p.target ?? 1)}</span>
          {task.unit && <span className="progress-unit"> {task.unit}</span>}
        </>
      );
      // 点数字手输（Rei 2026-10-26）：改成总数，或 +330 加上
      main = onCountInput && !isFinished(task.status) ? <CountNumber value={p.value} onSubmit={onCountInput}>{nums}</CountNumber> : nums;
      const left = formatAmount(Math.max(0, (p.target ?? 1) - p.value));
      sub = p.met ? tr('已达标') : (task.unit ? tr('还差 {max} {p}', { max: left, p: task.unit }) : tr('还差 {max} 次', { max: left }));
      break;
    }
    case 'countdown':
      main = countdownPhrase(task.target_date, today);
      sub = task.target_date ? formatTaskDate(task.target_date, { mode: dateMode, today }) : null;
      break;
  }
  return (
    <div className={`progress-panel${p.running ? ' is-running' : ''}`}>
      {(task.completion_mode === 'timer' || task.completion_mode === 'count') && <ProgressRing value={p.ratio} size={44} stroke={4} />}
      <div className="progress-text">
        <div className="progress-main">{main}</div>
        {(sub || recurring) && (
          <div className="progress-sub">
            {recurring && task.completion_mode !== 'once' && <span>{tr('今天')}</span>}
            {sub && <span>{sub}</span>}
            {recurring && streak > 0 && <span>{tr('已连续 {streak} 次', { streak })}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * 顶栏的完成方式小胶囊（Rei 2026-10-16 方案 A：计时 / 计数 / 倒数日不再占正文下面一大块）：
 * 「▶ 1:50 / 10 分钟」「3 / 5」「还有 12 天」，点开是完整的进度和开始 / 暂停。
 */
function CompletionPill({ store, task, today, primary, secondary, addCount, counting }: { store: Store; task: Task; today: string; primary: Act | null; secondary: Act | null; addCount: ReturnType<typeof useCountAdd>; counting: boolean }) {
  const p = store.progress(task.id, today);
  const recurring = !!task.recurrence;
  if (!p || (task.completion_mode === 'once' && !recurring)) return null;
  let text = '';
  switch (task.completion_mode) {
    case 'once':
      text = p.met ? tr('今天已打卡') : tr('今天还没打卡');
      break;
    case 'timer':
      text = formatDuration(p.value) + (p.target ? ` / ${formatTarget(p.target)}` : '');
      break;
    case 'count':
      text = `${formatAmount(p.value)} / ${formatAmount(p.target ?? 1)}${task.unit ? ` ${task.unit}` : ''}`;
      break;
    case 'countdown':
      text = countdownPhrase(task.target_date, today);
      break;
  }
  const ring = task.completion_mode === 'timer' || task.completion_mode === 'count';
  const ModeIcon = MODE_ICON[task.completion_mode];
  return (
    <PopoverPanel
      label={tr('进度')}
      trigger={
        <RacButton className={`completion-pill${p.running ? ' is-running' : ''}${p.met ? ' is-met' : ''}`} aria-label={tr('进度：{text}', { text })}>
          {ring ? <ProgressRing value={p.ratio} size={16} stroke={2.5} /> : <ModeIcon size={13} aria-hidden />}
          <span className="completion-pill-text">{text}</span>
        </RacButton>
      }
    >
      {(close) => (
        <div className="pop-section completion-pop">
          <Progress store={store} task={task} today={today} onCountInput={counting ? addCount : undefined} />
          {counting && (
            <div className="completion-pop-actions count-pop-actions">
              <CountUndoButton store={store} task={task} today={today} />
              <span className="grow" />
              <CountQuickButtons task={task} add={addCount} variant="primary" className="btn-sm" />
            </div>
          )}
          {(primary || secondary) && (
            <div className="completion-pop-actions">
              {secondary && (
                <Button variant="secondary" className="btn-sm" onPress={secondary.onPress}>
                  {secondary.icon}
                  {secondary.label}
                </Button>
              )}
              {primary && (
                <Button
                  variant="primary"
                  className="btn-sm"
                  isDisabled={!!primary.disabled}
                  onPress={() => {
                    primary.onPress();
                    if (task.completion_mode === 'once' || task.completion_mode === 'countdown') close();
                  }}
                >
                  {primary.icon}
                  {primary.label}
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </PopoverPanel>
  );
}

/** 任务字段（看到哪、进度、出发日期…）在属性列表里显示成什么。 */
function fieldText(def: FieldDef, v: FieldValue | undefined, today: string, mode: DateDisplay = 'auto'): string | null {
  if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) return null;
  switch (def.kind) {
    case 'episode':
      return formatEpisode(v as never);
    case 'date':
      return formatTaskDate(String(v), { mode, today });
    case 'select':
      return dataLabel(String(v));
    case 'multiselect':
      return (Array.isArray(v) ? v : [v]).map((x) => dataLabel(String(x))).join(tr('、'));
    case 'number':
    case 'progress':
      return def.unit ? (def.unit === '%' ? `${v}%` : `${v} ${dataLabel(def.unit)}`) : String(v);
    default:
      return Array.isArray(v) ? v.join(tr('、')) : String(v);
  }
}

/** 任务字段的一行：值（进度 % 带一条细进度条），点开改。 */
function TaskFieldRow({ store, def, task, today, onChange }: { store: Store; def: FieldDef; task: Task; today: string; onChange: (v: FieldValue) => void }) {
  const v = task.type_data[def.key];
  const dateMode = useDateDisplay();
  const text = fieldText(def, v, today, dateMode);
  const FieldIcon = def.kind === 'progress' ? Gauge : def.kind === 'episode' ? Tv : def.kind === 'date' ? CalendarDays : def.kind === 'number' ? Hash : def.kind === 'select' || def.kind === 'multiselect' ? ListChecks : Type;
  const pct = def.kind === 'progress' && def.unit === '%' && typeof v === 'number' ? Math.max(0, Math.min(100, v)) : null;
  return (
    <PropRow
      icon={<FieldIcon size={15} />}
      label={dataLabel(def.label)}
      empty={!text}
      wide={def.kind === 'episode' || def.kind === 'multiselect' || def.kind === 'money'}
      value={
        text ? (
          pct !== null ? (
            <span className="prop-progress">
              <span className="prop-progress-bar" aria-hidden>
                <span style={{ width: `${pct}%` }} />
              </span>
              {text}
            </span>
          ) : (
            text
          )
        ) : (
          tr('未填')
        )
      }
    >
      <div className="pop-section">
        <FieldInput store={store} def={def} value={v} onChange={onChange} />
      </div>
    </PropRow>
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
          <RacButton className={`prop-value${empty ? ' is-empty' : ''}`} {...(typeof value === 'string' ? { 'aria-label': tr('{label}：{value}', { label, value }) } : {})}>
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
const REL_LABEL: Record<RelKind, string> = { get pred() { return tr('先做完这些'); }, get succ() { return tr('做完后解锁'); }, get related() { return tr('相关任务'); } };

/** 「添加关系」菜单：三种关系各一项，选了打开挑任务的弹层。 */
function RelationMenu({ onPick, className }: { onPick: (k: RelKind) => void; className?: string }) {
  const items: MenuAction[] = [
    { id: 'pred', label: `${REL_LABEL.pred}…`, icon: <CornerLeftUp size={16} />, onAction: () => onPick('pred') },
    { id: 'succ', label: `${REL_LABEL.succ}…`, icon: <CornerRightDown size={16} />, onAction: () => onPick('succ') },
    { id: 'related', label: `${REL_LABEL.related}…`, icon: <Link2 size={16} />, onAction: () => onPick('related') },
  ];
  return <OverflowMenu label={tr('添加关系')} icon={<Network size={17} />} items={items} {...(className ? { className } : {})} />;
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
  const hint = kind === 'pred' ? tr('这些做完了，才能开始这件。') : kind === 'succ' ? tr('这件做完了，它们就能开始。') : tr('只是有关系，不分先后：不用等它，也不会解锁它。');
  return (
    <Sheet isOpen onOpenChange={(o) => !o && onClose()} title={REL_LABEL[kind]} className="modal-relpick">
      <p className="rel-pick-hint">{hint}</p>
      <TaskSearch
        store={store}
        exclude={exclude}
        label={tr('搜索任务，或写下新的一件')}
        onPick={(id) => {
          connect(id);
          onClose();
        }}
        onCreate={(text) => {
          const created = store.createTask({ body_md: text, group_id: task.group_id });
          connect(created.id);
          ui.toast({ message: tr('已新建「{text}」', { text }), actions: [{ label: tr('查看'), onPress: () => ui.openEditor(created.id) }] });
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
  const { settings, set } = useSettings();
  const edges = store.edges();
  const preds = predecessorsOf(edges, task.id).map((id) => store.get('task', id)).filter((t): t is Task => !!t);
  const succs = successorsOf(edges, task.id).map((id) => store.get('task', id)).filter((t): t is Task => !!t);
  const related = store.relatedTasks(task.id);
  const title = (t: Task) => titleOf(store, t);
  const derived = store.derived().get(task.id);
  // 同步合并后绕成圈、暂不生效的前后关系（两台设备各连了一条）
  const conflicts = store.conflictEdges().filter((e) => e.pred_id === task.id || e.succ_id === task.id);
  if (!preds.length && !succs.length && !related.length && !conflicts.length) return null;
  // 任务链开着、这件又有前后关系时：原地用任务链替换「先做完这些 / 做完后解锁」两段
  const hasChain = preds.length > 0 || succs.length > 0;
  const showChain = hasChain && settings.taskChain;
  const row = (t: Task, dir: RelKind) => {
    const state = t.status === '完成' ? 'done' : t.status === '关闭' ? 'closed' : 'open';
    const meta = taskStateText(store, t);
    const remove = () => (dir === 'pred' ? store.removeDependency(t.id, task.id) : dir === 'succ' ? store.removeDependency(task.id, t.id) : store.unlinkTasks(task.id, t.id));
    return (
      <li key={t.id} className={`rel-item is-${state}${dir === 'related' ? ' is-related' : ''}`}>
        <span className="rel-dot" aria-label={state === 'done' ? tr('已完成') : state === 'closed' ? tr('已关闭') : tr('未完成')}>
          {state === 'done' ? <Check size={11} strokeWidth={3} /> : state === 'closed' ? <X size={11} strokeWidth={3} /> : dir === 'related' ? <Link2 size={10} strokeWidth={2.5} /> : null}
        </span>
        <RacButton className="rel-title" onPress={() => ui.openEditor(t.id)}>
          {title(t)}
        </RacButton>
        {meta && state === 'open' && <span className="rel-meta">{meta}</span>}
        <RacButton className="icon-btn rel-remove" aria-label={dir === 'related' ? tr('不再和「{title}」相关', { title: title(t) }) : tr('去掉和「{title}」的关系', { title: title(t) })} onPress={remove}>
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
    <section className="relations" aria-label={trc('任务', '关系')}>
      <div className="detail-section-head">
        <h3 className="detail-section-title">{trc('任务', '关系')}</h3>
        {hasChain && <ChainToggle isOn={settings.taskChain} onChange={(on) => set('taskChain', on)} />}
      </div>
      {conflicts.map((e) => {
        const a = store.get('task', e.pred_id);
        const b = store.get('task', e.succ_id);
        if (!a || !b) return null;
        return (
          <div key={`${e.pred_id}>${e.succ_id}`} className="rel-conflict" role="alert">
            <AlertTriangle size={16} aria-hidden />
            <div className="grow">
              <div className="rel-conflict-title">{tr('先后关系绕成了圈')}</div>
              <div className="rel-conflict-text">
                {tr('在两台设备上分别连的前后关系合在一起，绕成了圈：「{title}」做完才能开始「{title2}」这一条暂时不生效。去掉其中一条就好。', { title: title(a), title2: title(b) })}</div>
            </div>
            <RacButton className="link-btn" onPress={() => store.removeDependency(e.pred_id, e.succ_id)}>
              {tr('去掉这条')}</RacButton>
          </div>
        );
      })}
      {showChain ? (
        <TaskChainInline store={store} task={task} />
      ) : (
        <>
          {group('pred', preds, derived?.state === '被阻塞' ? <span className="rel-count">{tr('还差 {length} 件', { length: derived.missing.length })}</span> : null)}
          {group('succ', succs)}
        </>
      )}
      {group(
        'related',
        related,
        <Tip content={tr('只是有关系，不分先后：不用等它，也不会解锁它')}>
          <RacButton className="icon-btn rel-hint" aria-label={tr('相关任务是什么')}>
            <CircleHelp size={13} aria-hidden />
          </RacButton>
        </Tip>,
      )}
    </section>
  );
}

/**
 * 详情里的「资料」（Rei 2026-10-28，docs/MULTI-TYPE.md）：挂的资料按库分组，每条点开是资料卡（编辑资料、在库里看），
 * 行尾 × 去掉（只解开关联，资料留在库里，提示里能撤销）。每个库下面接这个库的任务字段（看到哪、进度…）。
 * 底部「添加资料」打开跨库的挑选面板。类型和资料无关，换类型不动资料。
 */
function RefsSection({ store, task, today }: { store: Store; task: Task; today: string }) {
  const ui = useUi();
  const groups = store.taskRefs(task.id);
  const [edit, setEdit] = useState<{ type: TaskType; id: string } | null>(null);
  const patch = (p: Partial<Task>) => store.updateTask(task.id, p);
  const selected = new Set(groups.flatMap((g) => g.entries.map((e) => e.id)));
  // 任务字段：挂着资料的库各自的，外加老任务只选了库没选资料的那个库（type_id）；同一个 key 只出现一次
  const seen = new Set<string>();
  // 人物库不显示任务字段（人物库自带的「事由」等字段只在人物卡里用）
  const fieldsOf = (type: TaskType) =>
    (isPersonLibrary(type) ? [] : taskFieldsOf(type)).filter((f) => {
      if (seen.has(f.key)) return false;
      seen.add(f.key);
      return true;
    });
  const legacy = store.get('task_type', task.type_id);
  const legacyLib = hasLibrary(legacy) && !groups.some((g) => g.type.id === legacy.id) ? legacy : null;
  const remove = (e: LibraryEntry) => {
    const items = store.itemIdsOfTask(task.id);
    store.toggleTaskRef(task.id, e, false);
    ui.toast(
      {
        message: tr('已不再关联「{name}」', { name: e.name }),
        actions: [{ label: tr('撤销'), onPress: () => (e.kind === 'person' ? store.linkPerson(task.id, e.id) : store.setTaskItems(task.id, items)) }],
      },
      5000,
    );
  };
  const open = (type: TaskType, e: LibraryEntry) => {
    ui.openEditor(null);
    navigate(e.kind === 'person' ? { page: 'person', id: e.id } : { page: 'libitem', typeId: type.id, id: e.id });
  };
  const fieldRows = (type: TaskType) =>
    fieldsOf(type).map((f) => <TaskFieldRow key={f.key} store={store} def={f} task={task} today={today} onChange={(v) => patch({ type_data: { ...task.type_data, [f.key]: v } })} />);
  if (!groups.length && !legacyLib) return null;
  return (
    <div className="prop-list ref-section" role="group" aria-label={tr('资料')}>
      <RefList
        store={store}
        groups={groups}
        onRemove={remove}
        renderEntry={(e, type) => (
          <PopoverPanel
            label={e.name}
            placement="bottom start"
            className="is-wide"
            trigger={
              <RacButton className="ref-entry">
                {entryArt(store, e, artShape(type), 'ref-entry-art')}
                <span className="ref-entry-text">
                  <span className="ref-entry-name">{e.name}</span>
                  {e.subtitle && <span className="ref-entry-sub">{e.subtitle}</span>}
                </span>
              </RacButton>
            }
          >
            {(close) => (
              <div className="pop-section lib-pop">
                <ItemCard
                  store={store}
                  type={type}
                  size="lg"
                  entry={e}
                  actions={
                    <>
                      <Button
                        variant="secondary"
                        className="btn-sm"
                        onPress={() => {
                          close();
                          setEdit({ type, id: e.id });
                        }}
                      >
                        {tr('编辑资料')}
                      </Button>
                      <RacButton
                        className="link-btn item-card-open"
                        onPress={() => {
                          close();
                          open(type, e);
                        }}
                      >
                        {tr('在{name}里看', { name: libraryCopy(type).name })}
                        {e.uses > 1 ? tr(' · {uses} 件任务', { uses: e.uses }) : ''}
                        <ChevronRight size={13} aria-hidden />
                      </RacButton>
                    </>
                  }
                />
              </div>
            )}
          </PopoverPanel>
        )}
        extra={fieldRows}
      />
      {legacyLib && fieldRows(legacyLib)}
      <PopoverPanel
        label={tr('添加资料')}
        className="is-wide is-sheet"
        trigger={
          <RacButton className="link-btn ref-add">
            <Plus size={14} aria-hidden />
            {tr('添加资料')}
          </RacButton>
        }
      >
        <RefPicker store={store} selected={selected} defaultLibrary={legacyLib?.id ?? null} onToggle={(k, on) => store.toggleTaskRef(task.id, k, on)} />
      </PopoverPanel>
      {edit && <ItemSheet store={store} type={edit.type} itemId={edit.id} onClose={() => setEdit(null)} />}
    </div>
  );
}

function Detail({ task, mode }: { task: Task; mode: DetailMode }) {
  const ui = useUi();
  const store = useStore();
  const { layout } = useSettings();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [addRel, setAddRel] = useState<RelKind | null>(null);
  // 关掉详情：手机整页走「返回」（退回进来前那条浏览记录），右列 / 小窗直接取消选中
  const close = mode === 'page' ? ui.closeDetail : () => ui.openEditor(null);
  // 完成 / 关闭这件：弹窗和手机整页像以前一样收起；右列留着，显示「已完成」和「重新打开」
  const afterFinish = mode === 'pane' ? () => {} : close;
  // 右列和手机整页都是一栏：属性跟在正文后面（弹窗在宽屏上属性在右边一栏）
  const stacked = mode !== 'modal' || layout === 'mobile';
  const { primary, secondary, today, complete, addCount, counting } = useActions(store, task, afterFinish);
  // 附件：拖文件到详情整列（顶栏、正文、底栏都算）就加（Rei 2026-10-17；2026-10-25「拖拽文件到详情页面可以直接添加附件」）。
  // 弹窗（置顶小窗）没有自己的外框 ref，照旧用内容区。
  const owner = useMemo(() => ({ type: 'task' as const, id: task.id }), [task.id]);
  const dropRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLElement>(null);
  const addFiles = useAddFiles(owner);
  const dropping = useFileDrop(mode === 'modal' ? dropRef : frameRef, addFiles);
  const type = store.get('task_type', task.type_id);
  const typed = !!type && type.id !== PLAIN_TYPE_ID && shownFields(type).length > 0;
  const title = titleOf(store, task);
  // 没有库的旧式类型（只有字段、没有主字段）：还在正文上面显示一块它的信息
  const lib = hasLibrary(type) ? type : null;
  const patch = (p: Partial<Task>) => store.updateTask(task.id, p);
  const inDay = store.isInMyDay(task.id, today);
  const finished = isFinished(task.status);
  const recurring = !!task.recurrence;
  const derived = store.derived().get(task.id);
  const mediaKey = type?.fields.find((f) => f.media)?.key;
  const media = typed && mediaKey ? imageUrl(store, task.type_data[mediaKey]) : null;
  const primaryDef = type?.fields.find((f) => f.primary);
  const hasPrimary = !!primaryDef && !!task.type_data[primaryDef.key];
  const TypeIcon = typeIcon(type?.icon ?? 'file-text');
  let badge: ReactNode = null;
  if (task.status === '完成')
    badge = (
      <span className="status-badge is-done">
        <Check size={12} strokeWidth={3} />
        {tr('已完成')}</span>
    );
  else if (task.status === '关闭')
    badge = (
      <span className="status-badge is-closed">
        <CircleSlash size={12} />
        {tr('已关闭')}</span>
    );
  else if (derived?.state === '被阻塞') badge = <span className="status-badge is-blocked">{tr('还在等 {length} 件事', { length: derived.missing.length })}</span>;
  else if (task.status === '进行中') badge = <span className="status-badge is-active">{tr('进行中')}</span>;

  // 「关闭」在这里，不在底部（Rei 2026-10-17）；顺序和分隔见 lib/task-menu.ts
  const MENU_ICON = { myday: inDay ? <SunDim size={16} /> : <Sun size={16} />, done: <Check size={16} />, close: <CircleSlash size={16} />, reopen: <RotateCcw size={16} />, delete: <Trash2 size={16} /> };
  const MENU_DO: Record<DetailMenuId, () => void> = {
    myday: () => toggleMyDay(store, ui, task.id),
    done: complete,
    close: () => {
      closeTask(store, ui, task.id);
      afterFinish();
    },
    reopen: () => {
      store.reopenTask(task.id);
      ui.toast({ message: tr('已重新打开') }, 2500);
    },
    delete: () => setConfirmDelete(true),
  };
  const menu: MenuAction[] = detailMenu(task, inDay).map((e) => ({ ...e, icon: MENU_ICON[e.id], onAction: MENU_DO[e.id] }));

  // 属性：单值属性收成一行胶囊（Rei 2026-10-25 方案 A），资料行和任务字段仍是卡片里的行。
  // 附件紧跟在胶囊下面、资料卡片上面（Rei 2026-10-25「显示在属性块下方」）：从「+」加的附件就出现在「+」旁边。
  const props = (
    <div className="detail-props">
      <PropChips store={store} task={task} today={today} onAttach={addFiles} />
      <Attachments owner={owner} bare />
      <RefsSection store={store} task={task} today={today} />
    </div>
  );

  return (
    <>
      <DetailFrame
        mode={mode}
        title={title}
        finished={finished}
        onClose={close}
        headerStart={
          <>
            {badge}
            <CompletionPill store={store} task={task} today={today} primary={primary} secondary={secondary} addCount={addCount} counting={counting} />
          </>
        }
        headerEnd={
          <>
            <Tip content={inDay ? tr('移出我的一天') : tr('加入我的一天')}>
              <RacButton className={`icon-btn myday-toggle${inDay ? ' is-on' : ''}`} aria-label={inDay ? tr('移出我的一天') : tr('加入我的一天')} aria-pressed={inDay} onPress={() => toggleMyDay(store, ui, task.id)}>
                <Sun size={18} />
              </RacButton>
            </Tip>
            <RelationMenu onPick={setAddRel} />
            <OverflowMenu items={menu} />
          </>
        }
        frameRef={frameRef}
        overlay={mode === 'modal' ? null : <DropOverlay active={dropping} />}
        footer={
          finished ? (
            <>
              <span className="foot-note">{task.status === '完成' ? tr('这件事已经做完了。') : tr('这件事已关闭，不用再做了。')}</span>
              <span className="grow" />
              <Button
                variant="secondary"
                onPress={() => {
                  store.reopenTask(task.id);
                  ui.toast({ message: tr('已重新打开') }, 2500);
                }}
              >
                <RotateCcw size={16} />
                {recurring ? tr('恢复打卡') : tr('重新打开')}
              </Button>
            </>
          ) : counting ? (
            <>
              <CountUndoButton store={store} task={task} today={today} className="" />
              <span className="grow" />
              <CountQuickButtons task={task} add={addCount} variant="primary" className="primary-action" />
            </>
          ) : primary || secondary ? (
            <>
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
          ) : null
        }
      >
        <div ref={dropRef} className={`detail${stacked ? ' is-stacked' : ''}${layout === 'mobile' ? ' is-mobile' : ''}${dropping ? ' is-dropping' : ''}`}>
          {mode === 'modal' && <DropOverlay active={dropping} />}
          <div className="detail-main">
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
                    {hasPrimary ? title : <span className="muted">{tr('还没填{label}', { label: dataLabel(primaryDef?.label) })}</span>}
                  </Heading>
                  <div className="hero-sub">{dataLabel(type.name)}</div>
                </div>
              </div>
            )}
            <Body store={store} task={task} placeholder={typed ? tr('添加笔记…') : tr('写点什么…')} />
            {!lib && typed && type && (
              <Disclosure className="type-disclosure" defaultExpanded={!hasPrimary}>
                <Heading level={3} className="disclosure-head">
                  <RacButton slot="trigger" className="disclosure-trigger">
                    <ChevronRight size={14} className="disclosure-chevron" aria-hidden />
                    {tr('{name}信息', { name: dataLabel(type.name) })}</RacButton>
                </Heading>
                <DisclosurePanel>
                  <TypeFields bare store={store} type={type} data={task.type_data} onChange={(k, v) => patch({ type_data: { ...task.type_data, [k]: v } })} />
                </DisclosurePanel>
              </Disclosure>
            )}
            {stacked && props}
            <Relations store={store} task={task} />
          </div>
          {!stacked && <aside className="detail-side">{props}</aside>}
        </div>
      </DetailFrame>
      <RelationPicker store={store} task={task} kind={addRel} onClose={() => setAddRel(null)} />
      <ConfirmDialog
        isOpen={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={tr('删除这件任务？')}
        message={<>{tr('「{title}」会被删除，它和别的任务之间的关系也一起去掉。删除后不能恢复。', { title })}</>}
        confirmLabel={tr('删除')}
        danger
        onConfirm={() => {
          store.deleteTask(task.id);
          close();
          ui.toast({ message: tr('已删除') }, 2500);
        }}
      />
    </>
  );
}
