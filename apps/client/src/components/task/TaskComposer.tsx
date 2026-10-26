import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { Button as RacButton } from 'react-aria-components';
import { Bell, CalendarDays, CircleHelp, CornerDownRight, Link2, Shapes, Sparkles, Users, X } from 'lucide-react';
import { PLAIN_TYPE_ID, canRemind, episodeOf, findEpisode, firstLine, formatEpisode, stripEpisode, formatTaskDate, formatTaskTime, shouldJoinMyDay, hasLibrary, isPersonLibrary, libraryCopy, taskFieldsOf, toDateKey, type CompletionMode, type FieldValue, type NewTaskInput, type Store, type Task } from '@mindough/core';
import { newCountConfig, shownFields } from '@mindough/core';
import { useStore } from '../../store/StoreProvider';
import { useUi } from '../../lib/ui';
import { useSettings } from '../../lib/settings';
import { useDateDisplay } from '../../lib/date-display';
import { Button, PopoverPanel, Sheet, Tip } from '../../ui/primitives';
import { LazyMdEditor } from '../editor/LazyMdEditor';
import { formatRemindTime, RemindPanel } from './RemindPanel';
import { CategoryPicker } from '../CheckInCategory';
import { AvatarStack } from '../Avatar';
import { typeIcon } from '../../lib/icons';
import { titleOf } from '../../lib/view';
import { ItemCard, ItemEditor, LibraryPicker, draftEntry, emptyDraft, saveDraft, type ItemDraft } from '../library/Library';
import { createItemFromLookup } from '../../lib/lookup';
import { CompletionChoice, CompletionSentence, GroupList, PeopleList, RepeatEditor, TypeFields, TypeGrid, modeDefaults, type CompletionValue } from './pickers';
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
  typeId: string;
  typeData: Record<string, FieldValue>;
  modeTouched: boolean;
  recurrence: string | null;
  categoryId: string | null;
  date: string | null;
  /** 提醒时间「HH:MM」（有日期 / 倒数日 / 定期打卡时才出现）。 */
  remindTime: string | null;
  /** 任务时区（Rei 2026-10-25）：在日期面板里选过才有，空 = 跟着设备。 */
  timeZone: string | null;
  groupId: string | null;
  people: string[];
  /** 相关任务：建好后连成「相关」（只是有关系，不分先后）。 */
  related: string[];
  /** 资料库：选中的条目（资料或人物 id）、正在新建的资料、搜索词。 */
  entryId: string | null;
  newItem: ItemDraft | null;
  query: string;
  /** 看到哪：不要自动识别（点了 × 或撤销）。 */
  epIgnored: boolean;
  /** 已经从名字里识别并填进看到哪的：原来的整段名字（撤销时还回去）。 */
  epApplied: { fullName: string } | null;
}

function initialDraft(store: Store, d: NewTaskInput): Draft {
  const group = store.get('group', d.group_id ?? null);
  // 组的默认类型归档了照样用它（effectiveDefaultTypeId）；类型选择器里不列归档的，但当前值照常显示
  const typeId = d.type_id ?? store.effectiveDefaultTypeId(group) ?? PLAIN_TYPE_ID;
  const type = store.get('task_type', typeId);
  const mode: CompletionMode = d.completion_mode ?? type?.default_completion_mode ?? 'once';
  return {
    body: d.body_md ?? '',
    typeId,
    typeData: d.type_data ?? {},
    completion_mode: mode,
    target_value: d.target_value ?? (mode === 'timer' ? 10 * 60_000 : mode === 'count' ? 1 : null),
    unit: d.unit ?? null,
    // 计数的步长（Rei 2026-10-26）：按单位填默认值
    count_config: d.count_config ?? newCountConfig(d.unit),
    target_date: d.target_date ?? null,
    // 打开时指定了完成方式（比如在倒数日页新建）：换类型时不跟着类型的默认完成方式变
    modeTouched: d.completion_mode != null,
    recurrence: d.recurrence ?? null,
    categoryId: d.checkin_category_id ?? null,
    date: d.scheduled_date ?? null,
    remindTime: d.remind_time ?? null,
    timeZone: d.time_zone ?? null,
    groupId: d.group_id ?? null,
    people: [],
    related: [],
    entryId: d.library_item_id ?? (type && isPersonLibrary(type) && typeof d.type_data?.person === 'string' ? d.type_data.person : null),
    newItem: null,
    query: '',
    epIgnored: false,
    epApplied: null,
  };
}

/** 新建任务：先写内容，再选怎么算完成、多久一次；类型 / 日期 / 组 / 人物是一排小胶囊。 */
export function TaskComposer() {
  const ui = useUi();
  if (!ui.quickCreate) return null;
  return <Composer key={JSON.stringify(ui.quickCreate)} />;
}

function Composer() {
  const ui = useUi();
  const store = useStore();
  const { skin } = useSettings();
  const req = ui.quickCreate!;
  const [d, setD] = useState<Draft>(() => ({ ...initialDraft(store, req.defaults), related: req.related ?? [], people: req.people ?? [] }));
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  // 从在线结果建的资料：关掉面板时还没有任务用到的（取消了、或换了一个）就删掉，不在库里留下没用的条目
  const onlineCreated = useRef<string[]>([]);
  useEffect(
    () => () => {
      for (const id of onlineCreated.current) if (store.tasksOfItem(id).length === 0) store.deleteLibraryItem(id);
    },
    [store],
  );
  const today = toDateKey(store.now());
  const dateMode = useDateDisplay();
  const types = useMemo(() => store.pickableTypes(), [store]);
  const type = store.get('task_type', d.typeId);
  const lib = hasLibrary(type) ? type : null;
  const person = !!lib && isPersonLibrary(lib);
  const taskFields = lib ? taskFieldsOf(lib) : [];
  const typed = !!type && type.id !== PLAIN_TYPE_ID && shownFields(type).length > 0;
  const entry = lib && d.entryId ? store.libraryEntries(lib.id).find((e) => e.id === d.entryId) : undefined;
  const group = store.get('group', d.groupId);
  const people = d.people.map((id) => store.get('person', id)).filter((p): p is NonNullable<typeof p> => !!p);
  const after = req.after ? store.get('task', req.after) : undefined;
  const relatedTasks = d.related.map((id) => store.get('task', id)).filter((t): t is Task => !!t);
  const afterTitle = after ? titleOf(store, after) : '';
  const primaryKey = type?.fields.find((f) => f.primary)?.key;
  // 看到哪：从搜索框 / 内容第一行认出 S02E03、第二季第三集
  const epDef = taskFields.find((f) => f.kind === 'episode');
  const epFilled = !!epDef && d.typeData[epDef.key] !== undefined && d.typeData[epDef.key] !== null && d.typeData[epDef.key] !== '';
  const queryEp = epDef && !d.epIgnored ? stripEpisode(d.query) : { rest: d.query, match: null };
  const bodyEp = epDef && !d.epIgnored && !epFilled && !queryEp.match ? findEpisode(firstLine(d.body)) : null;
  const withEp = (typeData: Record<string, FieldValue>): Partial<Draft> =>
    epDef && queryEp.match && !epFilled ? { typeData: { ...typeData, [epDef.key]: queryEp.match.value }, epApplied: { fullName: d.query.trim() } } : {};
  const hasItem = !!entry || !!d.newItem?.name.trim();
  const hasContent = d.body.trim() !== '' || hasItem || (!lib && !!primaryKey && !!d.typeData[primaryKey]);
  const needsDate = d.completion_mode === 'countdown' && !d.target_date;
  const canAdd = hasContent && !needsDate;

  useEffect(() => {
    // 打开即可输入：React Aria 的 Dialog 会先把焦点放在自己身上，晚一帧再聚焦正文
    // 资料库类型由选择框自己聚焦
    if (lib && !entry) return;
    const t = setTimeout(() => document.querySelector<HTMLElement>('.composer-body .ProseMirror')?.focus(), 30);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const focusBody = () => setTimeout(() => document.querySelector<HTMLElement>('.composer-body .ProseMirror')?.focus(), 30);

  const title = after ? tr('接下来做什么') : group && req.defaults.group_id ? tr('在「{name}」里新建', { name: group.name }) : req.defaults.recurrence ? tr('新建打卡') : tr('新建任务');

  const remindable = canRemind({ recurrence: d.recurrence, completion_mode: d.completion_mode, scheduled_date: d.date, target_date: d.target_date });

  const submit = () => {
    if (!canAdd) return;
    const recurring = !!d.recurrence;
    // 资料库类型：资料存进库（新建的先存），任务只留任务字段
    let typeData = d.typeData;
    if (epDef && bodyEp) typeData = { ...typeData, [epDef.key]: bodyEp.value };
    let itemId: string | null = null;
    if (lib) {
      const own = new Set(taskFields.map((f) => f.key));
      typeData = Object.fromEntries(Object.entries(d.typeData).filter(([k]) => own.has(k)));
      const id = d.newItem?.name.trim() ? saveDraft(store, lib, d.newItem) : d.entryId;
      if (person) {
        if (id) typeData = { ...typeData, [primaryKey!]: id };
      } else itemId = id;
    }
    const input: NewTaskInput = {
      ...(d.body.trim() ? { body_md: d.body.trim() } : {}),
      type_id: d.typeId === PLAIN_TYPE_ID ? null : d.typeId,
      type_data: typeData,
      library_item_id: itemId,
      group_id: d.groupId,
      scheduled_date: d.date,
      completion_mode: d.completion_mode,
      target_value: d.completion_mode === 'timer' || d.completion_mode === 'count' ? d.target_value : null,
      unit: d.completion_mode === 'count' ? d.unit : null,
      count_config: d.completion_mode === 'count' ? d.count_config : {},
      target_date: d.completion_mode === 'countdown' ? d.target_date : null,
      recurrence: d.recurrence,
      checkin_category_id: recurring ? d.categoryId : null,
      remind_time: remindable ? d.remindTime : null,
      time_zone: d.timeZone,
    };
    const t = req.after ? store.createSuccessor(req.after, input) : store.createTask(input);
    for (const pid of d.people) store.linkPerson(t.id, pid);
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

  const pickType = (id: string) => {
    const nt = store.get('task_type', id);
    const p: Partial<Draft> = { typeId: id, entryId: null, newItem: null, query: '', epIgnored: false, epApplied: null };
    // 已经写了一行字再选类型：把它当作要找的名字（「沙丘」→ 选影视 → 直接搜到）
    if (hasLibrary(nt) && d.body.trim() && !d.body.includes('\n') && d.body.trim().length <= 40) Object.assign(p, { query: d.body.trim(), body: '' });
    // 类型可以带默认的完成方式（如旅行 → 倒数日）；用户自己挑过就不动
    if (nt && !d.modeTouched) Object.assign(p, modeDefaults(nt.default_completion_mode, d));
    set(p);
  };

  const TypeIcon = typeIcon(type?.icon ?? 'file-text');
  const mod = skin === 'apple' ? '⌘' : 'Ctrl';

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
          <Tip content={needsDate ? tr('先选好目标日期') : !hasContent ? (lib ? libraryCopy(lib).pick.replace('…', '') : tr('先写下要做什么')) : `${mod} + Enter`}>
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
        {lib &&
          (entry ? (
            <ItemCard
              store={store}
              type={lib}
              entry={entry}
              actions={
                <Button variant="quiet" className="item-card-swap" onPress={() => set({ entryId: null, query: '' })}>
                  {tr('换一个')}</Button>
              }
            />
          ) : d.newItem ? (
            <section className="composer-newitem" aria-label={tr('新的{short}', { short: libraryCopy(lib).short })}>
              <div className="composer-newitem-head">
                <span>
                  {tr('添加到{name}', { name: libraryCopy(lib).name })}
                </span>
                <RacButton className="link-btn" onPress={() => set({ newItem: null, query: d.newItem?.name ?? '' })}>
                  {tr('换一个')}</RacButton>
              </div>
              <ItemEditor store={store} type={lib} value={d.newItem} onChange={(v) => set({ newItem: v })} />
            </section>
          ) : (
            <LibraryPicker
              store={store}
              type={lib}
              query={d.query}
              searchText={queryEp.rest}
              onQueryChange={(q) => set({ query: q })}
              autoFocus
              onPick={(e) => {
                set({ entryId: e.id, query: '', ...withEp(d.typeData) });
                focusBody();
              }}
              onPickOnline={(r) => {
                const { id, created } = createItemFromLookup(store, lib, r);
                if (created) onlineCreated.current.push(id);
                set({ entryId: id, query: '', ...withEp(d.typeData) });
                focusBody();
              }}
              onCreate={(name) => {
                set({ newItem: emptyDraft(name), ...withEp(d.typeData) });
                setTimeout(() => document.querySelector<HTMLInputElement>('.composer-newitem .item-editor-fields input')?.focus(), 40);
              }}
            />
          ))}
        {epDef && ((queryEp.match && !epFilled) || bodyEp || (d.epApplied && epFilled)) && (
          <EpisodeChip
            text={formatEpisode(((queryEp.match && !epFilled ? queryEp.match : null) ?? bodyEp)?.value ?? episodeOf(d.typeData[epDef.key]) ?? {})}
            pending={!!((queryEp.match && !epFilled) || bodyEp)}
            onUndo={() => {
              if ((queryEp.match && !epFilled) || bodyEp) return set({ epIgnored: true });
              const typeData = { ...d.typeData };
              delete typeData[epDef.key];
              set({ typeData, epApplied: null, epIgnored: true, ...(d.newItem && d.epApplied ? { newItem: { ...d.newItem, name: d.epApplied.fullName } } : {}) });
            }}
          />
        )}
        <LazyMdEditor
          label={tr('内容')}
          className="composer-body"
          onEscape={() => ui.closeQuickCreate()}
          autoFocus={!(lib && !entry)}
          value={d.body}
          onChange={(v) => set({ body: v })}
          placeholder={lib || typed ? tr('还想记点什么？（可以不填）') : tr('要做什么？')}
        />

        <div className="prop-chips" role="group" aria-label={tr('更多属性')}>
          <PopoverPanel label={trc('属性', '资料库')} trigger={<PropChip icon={<TypeIcon size={14} />} label={trc('属性', '资料库')} {...(d.typeId !== PLAIN_TYPE_ID && type ? { value: dataLabel(type.name), color: type.color } : {})} />}>
            {(close) => (
              <div className="pop-section">
                <TypeGrid
                  types={types}
                  value={d.typeId}
                  onChange={(id) => {
                    pickType(id);
                    close();
                  }}
                />
                <p className="pop-note">{tr('放进资料库后，卡片换成它的样子，还会带上一组要填的信息。')}</p>
              </div>
            )}
          </PopoverPanel>
          <PopoverPanel label={tr('日期')} trigger={<PropChip icon={<CalendarDays size={14} />} label={tr('日期')} {...(d.date ? { value: formatTaskDate(d.date, { mode: dateMode, today, timeZone: d.timeZone }) } : {})} />}>
            {(close) => (
              <DatePanel
                value={d.date}
                today={today}
                timeZone={d.timeZone}
                onTimeZoneChange={(tz) => set({ timeZone: tz })}
                onChange={(v) => {
                  set({ date: v });
                  close();
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
            label={tr('和谁有关')}
            trigger={
              <PropChip
                icon={people.length ? <AvatarStack store={store} people={people} size={16} /> : <Users size={14} />}
                label={tr('和谁有关')}
                {...(people.length ? { value: people.map((p) => p.name).join(tr('、')) } : {})}
              />
            }
          >
            <PeopleList store={store} value={d.people} onChange={(ids) => set({ people: ids })} />
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

        {lib
          ? taskFields.length > 0 && <TypeFields bare store={store} type={{ ...lib, fields: taskFields }} data={d.typeData} onChange={(k, v) => set({ typeData: { ...d.typeData, [k]: v } })} />
          : typed && type && <TypeFields store={store} type={type} data={d.typeData} onChange={(k, v) => set({ typeData: { ...d.typeData, [k]: v } })} />}

        <section className="composer-section">
          <h3 className="composer-label">{tr('怎么算完成')}</h3>
          <CompletionChoice value={d.completion_mode} onChange={(m) => set({ ...modeDefaults(m, d), modeTouched: true })} />
          <CompletionSentence value={d} today={today} onChange={(p) => set(p)} />
        </section>

        <section className="composer-section">
          <h3 className="composer-label">{tr('多久一次')}</h3>
          <RepeatEditor value={d.recurrence} today={today} onChange={(r) => set({ recurrence: r })}>
            <CategoryPicker store={store} value={d.categoryId} onChange={(id) => set({ categoryId: id })} />
          </RepeatEditor>
        </section>
      </div>
    </Sheet>
  );
}
