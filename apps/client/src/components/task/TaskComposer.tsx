import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { Button as RacButton } from 'react-aria-components';
import { Bell, CalendarDays, CircleHelp, CornerDownRight, Library, Link2, Shapes, Sparkles, Tag, X } from 'lucide-react';
import { PLAIN_TYPE_ID, canRemind, findEpisode, firstLine, formatEpisode, formatTaskDate, formatTaskDateRange, formatTaskTime, normalizeRange, shouldJoinMyDay, hasLibrary, isPersonLibrary, taskFieldsOf, toDateKey, type CompletionMode, type FieldDef, type FieldValue, type LibraryEntry, type NewTaskInput, type Store, type Task, type TaskType } from '@mindough/core';
import { newCountConfig, shownFields } from '@mindough/core';
import { useStore } from '../../store/StoreProvider';
import { useUi } from '../../lib/ui';
import { useSettings } from '../../lib/settings';
import { useDateDisplay } from '../../lib/date-display';
import { Button, PopoverPanel, Sheet, Tip } from '../../ui/primitives';
import { LazyMdEditor } from '../editor/LazyMdEditor';
import { RemindPanel } from './RemindPanel';
import { CategoryLabels, CategoryList } from '../CategoryPicker';
import { titleOf } from '../../lib/view';
import { RefList, RefPicker, type RefKey } from '../library/RefPicker';
import { CompletionChoice, CompletionSentence, GroupList, RepeatEditor, TypeFields, modeDefaults, type CompletionValue } from './pickers';
import { DatePanel } from './DatePanel';
import { TaskSearch } from './TaskSearch';

/** 属性小胶囊：没设时是灰色的名称，设了显示值。点开是弹层。 */
export function PropChip({ icon, label, value, color }: { icon: ReactNode; label: string; value?: ReactNode; color?: string }) {
  return (
    <RacButton className={`prop-chip${value ? ' is-set' : ''}`} aria-label={value ? undefined : label} style={color ? ({ '--chip-color': color } as CSSProperties) : undefined}>
      <span className="prop-chip-icon" aria-hidden>
        {icon}
      </span>
      <span className="prop-chip-text">{value ?? label}</span>
    </RacButton>
  );
}


/** 「已识别 第 2 季第 3 集」：让人看见自动填了什么；还没填进去时是 ×（不用），填进去后是「撤销」。 */
function EpisodeChip({ text, pending, onUndo }: { text: string; pending: boolean; onUndo: () => void }) {
  return (
    <div className="ep-chip" role="status">
      <Sparkles size={13} aria-hidden />
      <span>
        {pending ? trx('已识别 {ep}，会填进「看到哪」', { ep: <b>{text}</b> }) : trx('已识别 {ep}', { ep: <b>{text}</b> })}
      </span>
      {pending ? (
        <Tip content={tr('不用识别')}>
          <RacButton className="ep-chip-x" aria-label={tr('不用识别')} onPress={onUndo}>
            <X size={13} />
          </RacButton>
        </Tip>
      ) : (
        <RacButton className="link-btn ep-chip-undo" onPress={onUndo}>
          {tr('撤销')}</RacButton>
      )}
    </div>
  );
}
import { markdownHelp } from '../Markdown';

import { dataLabel, tr, trc } from '../../lib/i18n';
import { trx } from '../../lib/trx';
interface Draft extends CompletionValue {
  body: string;
  typeData: Record<string, FieldValue>;
  modeTouched: boolean;
  recurrence: string | null;
  /** 类型（Rei 2026-10-28 起能选几个），按顺序。 */
  categoryIds: string[];
  date: string | null;
  /** 日期段的结束日（Rei 2026-10-26），空 = 单日。 */
  endDate: string | null;
  /** 提醒时间「HH:MM」（有日期 / 倒数日 / 定期打卡时才出现）。 */
  remindTime: string | null;
  /** 任务时区（Rei 2026-10-25）：在日期面板里选过才有，空 = 跟着设备。 */
  timeZone: string | null;
  groupId: string | null;
  /** 资料（Rei 2026-10-28：跨库多选，人物也在这里），按挑的先后。 */
  refs: RefKey[];
  /** 相关任务：建好后连成「相关」（只是有关系，不分先后）。 */
  related: string[];
  /** 看到哪：不要从正文第一行自动识别（点了 ×）。 */
  epIgnored: boolean;
}

function initialDraft(store: Store, d: NewTaskInput, people: readonly string[]): Draft {
  const typeId = d.type_id ?? null;
  const type = store.get('task_type', typeId);
  const mode: CompletionMode = d.completion_mode ?? type?.default_completion_mode ?? 'once';
  const refs: RefKey[] = [];
  if (d.library_item_id) refs.push({ kind: 'item', id: d.library_item_id });
  if (type && isPersonLibrary(type) && typeof d.type_data?.person === 'string') refs.push({ kind: 'person', id: d.type_data.person });
  for (const pid of people) if (!refs.some((r) => r.id === pid)) refs.push({ kind: 'person', id: pid });
  const cat = d.category_id ?? d.checkin_category_id ?? null;
  return {
    body: d.body_md ?? '',
    typeData: d.type_data ?? {},
    completion_mode: mode,
    target_value: d.target_value ?? (mode === 'timer' ? 10 * 60_000 : mode === 'count' ? 1 : null),
    unit: d.unit ?? null,
    // 计数的步长（Rei 2026-10-26）：按单位填默认值
    count_config: d.count_config ?? newCountConfig(d.unit),
    target_date: d.target_date ?? null,
    // 打开时指定了完成方式（比如在倒数日页新建）：挂上资料时不跟着库的默认完成方式变
    modeTouched: d.completion_mode != null,
    recurrence: d.recurrence ?? null,
    categoryIds: cat ? [cat] : [],
    date: d.scheduled_date ?? null,
    endDate: d.scheduled_date && d.end_date && d.end_date > d.scheduled_date ? d.end_date : null,
    remindTime: d.remind_time ?? null,
    timeZone: d.time_zone ?? null,
    groupId: d.group_id ?? null,
    refs,
    related: [],
    epIgnored: false,
  };
}

/** 新建任务：先写内容，再选怎么算完成、多久一次；类型 / 资料 / 日期 / 组是一排小胶囊。 */
export function TaskComposer() {
  const ui = useUi();
  if (!ui.quickCreate) return null;
  return <Composer key={JSON.stringify(ui.quickCreate)} />;
}

/** 挂着的资料（含人物）按库分组，给 RefList 用。 */
function refGroups(store: Store, refs: readonly RefKey[]): Array<{ type: TaskType; entries: LibraryEntry[] }> {
  const out: Array<{ type: TaskType; entries: LibraryEntry[] }> = [];
  const personLib = store.refLibraries().find((t) => isPersonLibrary(t)) ?? store.list('task_type').find((t) => isPersonLibrary(t));
  for (const r of refs) {
    const typeId = r.kind === 'person' ? personLib?.id : store.get('library_item', r.id)?.type_id;
    const type = store.get('task_type', typeId);
    if (!type) continue;
    const entry = store.libraryEntries(type.id).find((e) => e.id === r.id);
    if (!entry) continue;
    const g = out.find((x) => x.type.id === type.id);
    if (g) g.entries.push(entry);
    else out.push({ type, entries: [entry] });
  }
  // 人物放最后（同详情）
  return [...out.filter((g) => !isPersonLibrary(g.type)), ...out.filter((g) => isPersonLibrary(g.type))];
}

function Composer() {
  const ui = useUi();
  const store = useStore();
  const { skin } = useSettings();
  const req = ui.quickCreate!;
  const [d, setD] = useState<Draft>(() => ({ ...initialDraft(store, req.defaults, req.people ?? []), related: req.related ?? [] }));
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  // 从在线结果建的资料：关掉面板时还没有任务用到的（取消了、或去掉了）就删掉，不在库里留下没用的条目
  const onlineCreated = useRef<string[]>([]);
  useEffect(
    () => () => {
      for (const id of onlineCreated.current) if (store.tasksOfItem(id).length === 0) store.deleteLibraryItem(id);
    },
    [store],
  );
  const today = toDateKey(store.now());
  const dateMode = useDateDisplay();
  const group = store.get('group', d.groupId);
  // 项目的默认资料库（或打开时指定的库）：资料面板先打开它，它的任务字段也先列出来
  const defaultLib = store.get('task_type', req.defaults.type_id ?? store.effectiveDefaultTypeId(group));
  const groups = refGroups(store, d.refs);
  const firstItemType = groups.find((g) => !isPersonLibrary(g.type))?.type;
  // 任务的「主库」= 第一条资料的库，没有资料时用默认库（决定任务字段、正文模板）
  const mainType = firstItemType ?? (hasLibrary(defaultLib) ? defaultLib : undefined);
  const legacyType = !mainType && defaultLib && defaultLib.id !== PLAIN_TYPE_ID && shownFields(defaultLib).length > 0 ? defaultLib : undefined;
  // 任务字段：每个挂着资料的库各自的，外加默认库；同一个 key 只要一个
  const fieldLibs = [...groups.map((g) => g.type), ...(mainType && !groups.some((g) => g.type.id === mainType.id) ? [mainType] : [])];
  const seen = new Set<string>();
  const fieldSets = fieldLibs
    .map((type) => ({ type, fields: taskFieldsOf(type).filter((f) => (seen.has(f.key) ? false : (seen.add(f.key), true))) }))
    .filter((x) => x.fields.length > 0);
  const allTaskFields: FieldDef[] = fieldSets.flatMap((x) => x.fields);
  const cats = d.categoryIds.map((id) => store.category(id)).filter((c): c is NonNullable<typeof c> => !!c);
  const after = req.after ? store.get('task', req.after) : undefined;
  const relatedTasks = d.related.map((id) => store.get('task', id)).filter((t): t is Task => !!t);
  const afterTitle = after ? titleOf(store, after) : '';
  // 看到哪：从内容第一行认出 S02E03、第二季第三集
  const epDef = allTaskFields.find((f) => f.kind === 'episode');
  const epFilled = !!epDef && d.typeData[epDef.key] !== undefined && d.typeData[epDef.key] !== null && d.typeData[epDef.key] !== '';
  const bodyEp = epDef && !d.epIgnored && !epFilled ? findEpisode(firstLine(d.body)) : null;
  const hasContent = d.body.trim() !== '' || d.refs.length > 0 || (!!legacyType && Object.values(d.typeData).some((v) => v !== null && v !== ''));
  const needsDate = d.completion_mode === 'countdown' && !d.target_date;
  const canAdd = hasContent && !needsDate;

  useEffect(() => {
    // 打开即可输入：React Aria 的 Dialog 会先把焦点放在自己身上，晚一帧再聚焦正文
    const t = setTimeout(() => document.querySelector<HTMLElement>('.composer-body .ProseMirror')?.focus(), 30);
    return () => clearTimeout(t);
  }, []);

  const title = after ? tr('接下来做什么') : group && req.defaults.group_id ? tr('在「{name}」里新建', { name: group.name }) : req.defaults.recurrence ? tr('新建打卡') : tr('新建任务');

  const remindable = canRemind({ recurrence: d.recurrence, completion_mode: d.completion_mode, scheduled_date: d.date, target_date: d.target_date });

  /** 挂上 / 去掉一条资料。挂上第一条资料时：正文空着就套这个库的正文模板，完成方式没手选过就用库的默认。 */
  const toggleRef = (k: RefKey, on: boolean) => {
    setD((x) => {
      if (!on) return { ...x, refs: x.refs.filter((r) => r.id !== k.id) };
      if (x.refs.some((r) => r.id === k.id)) return x;
      const next: Draft = { ...x, refs: [...x.refs, k] };
      const hadItem = x.refs.some((r) => r.kind === 'item');
      const type = k.kind === 'item' ? store.get('task_type', store.get('library_item', k.id)?.type_id) : undefined;
      if (type && !hadItem) {
        if (!x.body.trim() && type.body_template) next.body = dataLabel(type.body_template);
        if (!x.modeTouched) Object.assign(next, modeDefaults(type.default_completion_mode, x));
      }
      return next;
    });
  };

  const submit = () => {
    if (!canAdd) return;
    const recurring = !!d.recurrence;
    let typeData = d.typeData;
    if (epDef && bodyEp) typeData = { ...typeData, [epDef.key]: bodyEp.value };
    // 有库的：任务只留任务字段（资料字段在资料上）；旧式没库的类型照旧整份存
    if (mainType) {
      const own = new Set(allTaskFields.map((f) => f.key));
      typeData = Object.fromEntries(Object.entries(typeData).filter(([k]) => own.has(k)));
    }
    const items = d.refs.filter((r) => r.kind === 'item').map((r) => r.id);
    const people = d.refs.filter((r) => r.kind === 'person').map((r) => r.id);
    const typeId = mainType?.id ?? legacyType?.id ?? null;
    const input: NewTaskInput = {
      ...(d.body.trim() ? { body_md: d.body.trim() } : {}),
      type_id: typeId === PLAIN_TYPE_ID ? null : typeId,
      type_data: typeData,
      library_item_id: items[0] ?? null,
      group_id: d.groupId,
      scheduled_date: d.date,
      end_date: d.recurrence ? null : d.endDate,
      completion_mode: d.completion_mode,
      target_value: d.completion_mode === 'timer' || d.completion_mode === 'count' ? d.target_value : null,
      unit: d.completion_mode === 'count' ? d.unit : null,
      count_config: d.completion_mode === 'count' ? d.count_config : {},
      target_date: d.completion_mode === 'countdown' ? d.target_date : null,
      recurrence: d.recurrence,
      category_id: d.categoryIds[0] ?? null,
      remind_time: remindable ? d.remindTime : null,
      time_zone: d.timeZone,
    };
    const t = req.after ? store.createSuccessor(req.after, input) : store.createTask(input);
    if (d.categoryIds.length > 1) store.setTaskCategories(t.id, d.categoryIds);
    if (items.length > 1) store.setTaskItems(t.id, items);
    for (const pid of people) store.linkPerson(t.id, pid);
    // 和「接在后面」的那件已经有前后关系了，就不再标相关
    for (const rid of d.related) if (rid !== req.after && store.get('task', rid)) store.linkTasks(t.id, rid);
    // 只有从「我的一天」新建的才放进今天（Rei 2026-10-16 改了 M0 决定 8）；别处新建、没日期的默认在「待安排」
    const toMyDay = shouldJoinMyDay({ fromMyDay: !!req.myDay, recurring, date: d.date, today });
    if (toMyDay) store.addToMyDay(t.id);
    ui.closeQuickCreate();
    const name = titleOf(store, store.get('task', t.id) ?? t);
    ui.toast(
      {
        tone: 'success',
        message: recurring ? tr('已添加到打卡：「{name}」', { name }) : toMyDay ? tr('已添加到我的一天：「{name}」', { name }) : !d.date && t.completion_mode !== 'countdown' ? tr('已添加到待安排：「{name}」', { name }) : tr('已添加：「{name}」', { name }),
        actions: [{ label: tr('查看'), onPress: () => ui.openEditor(t.id) }],
      },
      4000,
    );
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  };

  const mod = skin === 'apple' ? '⌘' : 'Ctrl';
  const refCount = d.refs.length;
  const firstRef = groups[0]?.entries[0];

  return (
    <Sheet
      isOpen
      onOpenChange={(o) => !o && ui.closeQuickCreate()}
      title={title}
      className="modal-composer"
      onKeyDown={onKeyDown}
      footer={
        <>
          <Tip content={markdownHelp()}>
            <RacButton className="icon-btn composer-help" aria-label={tr('写法提示')}>
              <CircleHelp size={16} />
            </RacButton>
          </Tip>
          <span className="grow" />
          <Button variant="secondary" className="composer-cancel" onPress={() => ui.closeQuickCreate()}>
            {tr('取消')}</Button>
          <Tip content={needsDate ? tr('先选好目标日期') : !hasContent ? tr('先写下要做什么') : `${mod} + Enter`}>
            <Button variant="primary" className="composer-add" isDisabled={!canAdd} onPress={submit}>
              {tr('添加')}</Button>
          </Tip>
        </>
      }
    >
      <div className="composer">
        {after && (
          <div className="composer-context">
            <CornerDownRight size={14} aria-hidden />
            <span className="ellipsis">{tr('做完「{afterTitle}」之后', { afterTitle })}</span>
          </div>
        )}
        {epDef && bodyEp && <EpisodeChip text={formatEpisode(bodyEp.value)} pending onUndo={() => set({ epIgnored: true })} />}
        <LazyMdEditor
          label={tr('内容')}
          className="composer-body"
          onEscape={() => ui.closeQuickCreate()}
          autoFocus
          value={d.body}
          onChange={(v) => set({ body: v })}
          placeholder={refCount ? tr('还想记点什么？（可以不填）') : tr('要做什么？')}
        />

        <div className="prop-chips" role="group" aria-label={tr('更多属性')}>
          <PopoverPanel label={trc('分类', '类型')} className="is-wide is-sheet cat-select-pop" trigger={<PropChip icon={<Tag size={14} />} label={trc('分类', '类型')} {...(cats.length ? { value: <CategoryLabels cats={cats} />, color: cats[0]!.color } : {})} />}>
            <CategoryList store={store} value={d.categoryIds} onChange={(ids) => set({ categoryIds: ids })} />
          </PopoverPanel>
          <PopoverPanel
            label={tr('资料')}
            className="is-wide is-sheet"
            trigger={<PropChip icon={<Library size={14} />} label={tr('资料')} {...(firstRef ? { value: refCount > 1 ? `${firstRef.name} +${refCount - 1}` : firstRef.name } : {})} />}
          >
            <RefPicker store={store} selected={new Set(d.refs.map((r) => r.id))} defaultLibrary={defaultLib?.id ?? null} onToggle={toggleRef} onCreatedOnline={(id) => onlineCreated.current.push(id)} />
          </PopoverPanel>
          <PopoverPanel
            label={tr('日期')}
            trigger={
              <PropChip
                icon={<CalendarDays size={14} />}
                label={tr('日期')}
                {...(d.date ? { value: d.endDate ? formatTaskDateRange(d.date, d.endDate, { mode: dateMode, today, timeZone: d.timeZone }) : formatTaskDate(d.date, { mode: dateMode, today, timeZone: d.timeZone }) } : {})}
              />
            }
          >
            {(close) => (
              <DatePanel
                value={d.date}
                end={d.endDate}
                today={today}
                timeZone={d.timeZone}
                onTimeZoneChange={(tz) => set({ timeZone: tz })}
                onChange={(v) => {
                  set({ date: v, endDate: null });
                  close();
                }}
                onRangeChange={(start, end, done) => {
                  const r = normalizeRange(start, end);
                  set({ date: r.start, endDate: r.end });
                  if (done) close();
                }}
              />
            )}
          </PopoverPanel>
          {remindable && (
            <PopoverPanel label={tr('提醒')} trigger={<PropChip icon={<Bell size={14} />} label={tr('提醒')} {...(d.remindTime ? { value: formatTaskTime(d.remindTime, { mode: dateMode, date: d.date, timeZone: d.timeZone }) } : {})} />}>
              {(close) => (
                <RemindPanel
                  value={d.remindTime}
                  task={{ recurrence: d.recurrence, completion_mode: d.completion_mode, target_value: d.target_value }}
                  onChange={(v) => {
                    set({ remindTime: v });
                    close();
                  }}
                />
              )}
            </PopoverPanel>
          )}
          <PopoverPanel label={trc('属性', '项目')} trigger={<PropChip icon={<Shapes size={14} />} label={trc('属性', '项目')} {...(group ? { value: `${group.icon} ${group.name}` } : {})} />}>
            {(close) => (
              <GroupList
                store={store}
                value={d.groupId}
                onChange={(id) => {
                  set({ groupId: id });
                  close();
                }}
              />
            )}
          </PopoverPanel>
          <PopoverPanel
            label={tr('相关任务')}
            trigger={
              <PropChip
                icon={<Link2 size={14} />}
                label={tr('相关任务')}
                {...(relatedTasks.length ? { value: relatedTasks.length === 1 ? tr('「{titleOf}」', { titleOf: titleOf(store, relatedTasks[0]!) }) : tr('{length} 件相关', { length: relatedTasks.length }) } : {})}
              />
            }
          >
            <TaskSearch
              store={store}
              exclude={new Set(req.after ? [req.after] : [])}
              selected={new Set(d.related)}
              label={tr('搜索相关的任务')}
              onPick={(id) => set({ related: d.related.includes(id) ? d.related.filter((x) => x !== id) : [...d.related, id] })}
            />
            <p className="pop-note">{tr('只是有关系，不分先后。')}</p>
          </PopoverPanel>
        </div>

        {groups.length > 0 && <RefList store={store} groups={groups} onRemove={(e) => toggleRef({ kind: e.kind, id: e.id }, false)} />}

        {fieldSets.map(({ type, fields }) => (
          <TypeFields key={type.id} bare store={store} type={{ ...type, fields }} data={d.typeData} onChange={(k, v) => set({ typeData: { ...d.typeData, [k]: v } })} />
        ))}
        {legacyType && <TypeFields store={store} type={legacyType} data={d.typeData} onChange={(k, v) => set({ typeData: { ...d.typeData, [k]: v } })} />}

        <section className="composer-section">
          <h3 className="composer-label">{tr('怎么算完成')}</h3>
          <CompletionChoice value={d.completion_mode} onChange={(m) => set({ ...modeDefaults(m, d), modeTouched: true })} />
          <CompletionSentence value={d} today={today} onChange={(p) => set(p)} />
        </section>

        <section className="composer-section">
          <h3 className="composer-label">{tr('多久一次')}</h3>
          <RepeatEditor value={d.recurrence} today={today} onChange={(r) => set({ recurrence: r })} />
        </section>
      </div>
    </Sheet>
  );
}
