import { useEffect, useMemo, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { Button as RacButton } from 'react-aria-components';
import { CalendarDays, CircleHelp, CornerDownRight, Shapes, Users } from 'lucide-react';
import { PLAIN_TYPE_ID, friendlyDate, taskTitle, toDateKey, type CompletionMode, type FieldValue, type NewTaskInput, type Store } from '@mindough/core';
import { useStore } from '../../store/StoreProvider';
import { useUi } from '../../lib/ui';
import { useSettings } from '../../lib/settings';
import { AutoTextarea, Button, PopoverPanel, Sheet, Tip } from '../../ui/primitives';
import { CategoryPicker } from '../CheckInCategory';
import { AvatarStack } from '../Avatar';
import { typeIcon } from '../../lib/icons';
import { resolver } from '../../lib/view';
import { CompletionChoice, CompletionSentence, GroupList, PeopleList, RepeatEditor, TypeFields, TypeGrid, modeDefaults, type CompletionValue } from './pickers';
import { DatePanel } from './DatePanel';

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

export const MARKDOWN_HELP = (
  <span className="md-help">
    可以用 Markdown 排版：
    <br />
    <code># 标题</code> <code>- [ ] 清单</code> <code>**粗体**</code>
  </span>
);

interface Draft extends CompletionValue {
  body: string;
  typeId: string;
  typeData: Record<string, FieldValue>;
  modeTouched: boolean;
  recurrence: string | null;
  categoryId: string | null;
  date: string | null;
  groupId: string | null;
  people: string[];
}

function initialDraft(store: Store, d: NewTaskInput): Draft {
  const group = store.get('group', d.group_id ?? null);
  const typeId = d.type_id ?? group?.default_type_id ?? PLAIN_TYPE_ID;
  const type = store.get('task_type', typeId);
  const mode: CompletionMode = d.completion_mode ?? type?.default_completion_mode ?? 'once';
  return {
    body: d.body_md ?? '',
    typeId,
    typeData: d.type_data ?? {},
    completion_mode: mode,
    target_value: d.target_value ?? (mode === 'timer' ? 10 * 60_000 : mode === 'count' ? 1 : null),
    unit: d.unit ?? null,
    target_date: d.target_date ?? null,
    modeTouched: false,
    recurrence: d.recurrence ?? null,
    categoryId: d.checkin_category_id ?? null,
    date: d.scheduled_date ?? null,
    groupId: d.group_id ?? null,
    people: [],
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
  const [d, setD] = useState<Draft>(() => initialDraft(store, req.defaults));
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  const today = toDateKey(store.now());
  const types = useMemo(() => store.list('task_type').filter((t) => !t.hidden).sort((a, b) => a.sort - b.sort), [store]);
  const type = store.get('task_type', d.typeId);
  const typed = !!type && type.id !== PLAIN_TYPE_ID && type.fields.length > 0;
  const group = store.get('group', d.groupId);
  const people = d.people.map((id) => store.get('person', id)).filter((p): p is NonNullable<typeof p> => !!p);
  const after = req.after ? store.get('task', req.after) : undefined;
  const afterTitle = after ? taskTitle(after, store.get('task_type', after.type_id), resolver(store)) : '';
  const primaryKey = type?.fields.find((f) => f.primary)?.key;
  const hasContent = d.body.trim() !== '' || (!!primaryKey && !!d.typeData[primaryKey]);
  const needsDate = d.completion_mode === 'countdown' && !d.target_date;
  const canAdd = hasContent && !needsDate;

  useEffect(() => {
    // 打开即可输入：React Aria 的 Dialog 会先把焦点放在自己身上，晚一帧再聚焦正文
    const t = setTimeout(() => document.querySelector<HTMLTextAreaElement>('.composer-body')?.focus(), 30);
    return () => clearTimeout(t);
  }, []);

  const title = after ? '接下来做什么' : group && req.defaults.group_id ? `在「${group.name}」里新建` : req.defaults.recurrence ? '新建打卡' : '新建任务';

  const submit = () => {
    if (!canAdd) return;
    const recurring = !!d.recurrence;
    const input: NewTaskInput = {
      ...(d.body.trim() ? { body_md: d.body.trim() } : {}),
      type_id: d.typeId === PLAIN_TYPE_ID ? null : d.typeId,
      type_data: d.typeData,
      group_id: d.groupId,
      scheduled_date: d.date,
      completion_mode: d.completion_mode,
      target_value: d.completion_mode === 'timer' || d.completion_mode === 'count' ? d.target_value : null,
      unit: d.completion_mode === 'count' ? d.unit : null,
      target_date: d.completion_mode === 'countdown' ? d.target_date : null,
      recurrence: d.recurrence,
      checkin_category_id: recurring ? d.categoryId : null,
    };
    const t = req.after ? store.createSuccessor(req.after, input) : store.createTask(input);
    for (const pid of d.people) store.linkPerson(t.id, pid);
    // 从侧边栏 / 快捷键新建（不在组里、没定日期、不是打卡）的任务自动进我的一天
    const toMyDay = !req.after && req.defaults.scheduled_date === undefined && !d.groupId && !d.date && !recurring;
    if (toMyDay) store.addToMyDay(t.id);
    ui.closeQuickCreate();
    const name = taskTitle(t, type, resolver(store));
    ui.toast(
      {
        tone: 'success',
        message: recurring ? `已添加到打卡：「${name}」` : toMyDay ? `已添加到我的一天：「${name}」` : `已添加：「${name}」`,
        actions: [{ label: '查看', onPress: () => ui.openEditor(t.id) }],
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
    const p: Partial<Draft> = { typeId: id };
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
          <Tip content={MARKDOWN_HELP}>
            <RacButton className="icon-btn composer-help" aria-label="写法提示">
              <CircleHelp size={16} />
            </RacButton>
          </Tip>
          <span className="grow" />
          <Button variant="secondary" className="composer-cancel" onPress={() => ui.closeQuickCreate()}>
            取消
          </Button>
          <Tip content={needsDate ? '先选好目标日期' : !hasContent ? '先写下要做什么' : `${mod} + Enter`}>
            <Button variant="primary" className="composer-add" isDisabled={!canAdd} onPress={submit}>
              添加
            </Button>
          </Tip>
        </>
      }
    >
      <div className="composer">
        {after && (
          <div className="composer-context">
            <CornerDownRight size={14} aria-hidden />
            <span className="ellipsis">做完「{afterTitle}」之后</span>
          </div>
        )}
        <AutoTextarea label="内容" className="composer-body" value={d.body} onChange={(v) => set({ body: v })} placeholder={typed ? '还想记点什么？（可以不填）' : '要做什么？'} minRows={1} />

        <div className="prop-chips" role="group" aria-label="更多属性">
          <PopoverPanel label="类型" trigger={<PropChip icon={<TypeIcon size={14} />} label="类型" {...(d.typeId !== PLAIN_TYPE_ID && type ? { value: type.name, color: type.color } : {})} />}>
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
                <p className="pop-note">类型决定卡片的样子，并带上一组要填的信息。</p>
              </div>
            )}
          </PopoverPanel>
          <PopoverPanel label="日期" trigger={<PropChip icon={<CalendarDays size={14} />} label="日期" {...(d.date ? { value: friendlyDate(d.date, today) } : {})} />}>
            {(close) => (
              <DatePanel
                value={d.date}
                today={today}
                onChange={(v) => {
                  set({ date: v });
                  close();
                }}
              />
            )}
          </PopoverPanel>
          <PopoverPanel label="组" trigger={<PropChip icon={<Shapes size={14} />} label="组" {...(group ? { value: `${group.icon} ${group.name}` } : {})} />}>
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
            label="和谁有关"
            trigger={
              <PropChip
                icon={people.length ? <AvatarStack store={store} people={people} size={16} /> : <Users size={14} />}
                label="和谁有关"
                {...(people.length ? { value: people.map((p) => p.name).join('、') } : {})}
              />
            }
          >
            <PeopleList store={store} value={d.people} onChange={(ids) => set({ people: ids })} />
          </PopoverPanel>
        </div>

        {typed && type && <TypeFields store={store} type={type} data={d.typeData} onChange={(k, v) => set({ typeData: { ...d.typeData, [k]: v } })} />}

        <section className="composer-section">
          <h3 className="composer-label">怎么算完成</h3>
          <CompletionChoice value={d.completion_mode} onChange={(m) => set({ ...modeDefaults(m, d), modeTouched: true })} />
          <CompletionSentence value={d} today={today} onChange={(p) => set(p)} />
        </section>

        <section className="composer-section">
          <h3 className="composer-label">多久一次</h3>
          <RepeatEditor value={d.recurrence} today={today} onChange={(r) => set({ recurrence: r })}>
            <CategoryPicker store={store} value={d.categoryId} onChange={(id) => set({ categoryId: id })} />
          </RepeatEditor>
        </section>
      </div>
    </Sheet>
  );
}
