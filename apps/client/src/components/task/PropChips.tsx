/**
 * 任务详情的属性胶囊行（Rei 2026-10-25 选方案 A · 胶囊行）：
 * - 只显示设置过的单值属性（默认值 = 没设，见 lib/prop-chips.ts），一行胶囊、自动换行，顺序固定；
 * - 点胶囊打开这个属性原来的选择器（类型格子、完成方式、日期面板、重复、打卡分类、提醒、组、人物）；
 * - 桌面悬停出现小 ×，点了清除回默认（胶囊消失，提示里可撤销）；触屏没有 ×，在选择器里选「无」那一项；
 * - 键盘：Tab 到胶囊，Enter / 空格打开，Backspace / Delete 清除；
 * - 行尾「+」：菜单列出没设的属性，选一项直接打开它的选择器；全都设了「+」隐藏；一个都没设时是「+ 添加属性」。
 * 资料行和任务字段（进度、看到哪…）不在这里，仍在原来的属性卡片里。
 */
import { useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { Button as RacButton, Dialog, Menu, MenuItem, MenuTrigger, Popover } from 'react-aria-components';
import { Bell, CalendarDays, Plus, Repeat, Shapes, Tag, Users, X } from 'lucide-react';
import {
  PLAIN_TYPE_ID,
  describeCompletion,
  describeRecurrence,
  friendlyDate,
  isFinished,
  parseRecurrence,
  type Person,
  type Store,
  type Task,
} from '@mindough/core';
import { useUi } from '../../lib/ui';
import { useLunarUi } from '../../lib/lunar';
import { dataLabel, tr } from '../../lib/i18n';
import { typeIcon } from '../../lib/icons';
import { clearPatch, setProps, unsetProps, type PropId } from '../../lib/prop-chips';
import { AvatarStack } from '../Avatar';
import { CategoryPicker } from '../CheckInCategory';
import { CompletionChoice, CompletionSentence, GroupList, MODE_ICON, PeopleList, RepeatEditor, TypeGrid, modeDefaults } from './pickers';
import { DatePanel } from './DatePanel';
import { formatRemindTime, RemindPanel } from './RemindPanel';

/** 属性名（胶囊的 aria-label、「+」菜单、弹层标题共用；叫法同原来的属性列表）。 */
export function propLabel(id: PropId): string {
  switch (id) {
    case 'type':
      return tr('类型');
    case 'mode':
      return tr('完成方式');
    case 'date':
      return tr('日期');
    case 'repeat':
      return tr('重复');
    case 'category':
      return tr('打卡分类');
    case 'remind':
      return tr('提醒');
    case 'group':
      return tr('组');
    case 'people':
      return tr('和谁有关');
  }
}

/** 弹层要宽一点的（里面是一段句子 / 列表）。 */
const WIDE: ReadonlySet<PropId> = new Set(['mode', 'repeat', 'category']);

interface ChipView {
  icon: ReactNode;
  text: ReactNode;
  /** 读屏用的值 */
  aria: string;
  danger?: boolean;
  color?: string;
}

export function PropChips({ store, task, today, people, linked }: { store: Store; task: Task; today: string; people: Person[]; linked: string[] }) {
  const ui = useUi();
  const lunarUi = useLunarUi();
  const [open, setOpen] = useState<{ id: PropId; via: 'chip' | 'add' } | null>(null);
  const anchor = useRef<HTMLElement | null>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const chipRefs = useRef(new Map<PropId, HTMLElement>());
  const rowRef = useRef<HTMLDivElement>(null);

  const shown = setProps(task, people.length);
  const missing = unsetProps(task, people.length);
  const patch = (p: Partial<Task>) => store.updateTask(task.id, p);
  const type = store.get('task_type', task.type_id);
  const group = store.get('group', task.group_id);
  const cat = task.checkin_category_id ? store.get('checkin_category', task.checkin_category_id) : undefined;

  const view = (id: PropId): ChipView => {
    switch (id) {
      case 'type': {
        const Icon = typeIcon(type?.icon ?? 'file-text');
        const name = type ? dataLabel(type.name) : tr('普通');
        return { icon: <Icon size={14} />, text: name, aria: name, ...(type?.color ? { color: type.color } : {}) };
      }
      case 'mode': {
        const Icon = MODE_ICON[task.completion_mode];
        const s = describeCompletion(task, today);
        return { icon: <Icon size={14} />, text: s, aria: s };
      }
      case 'date': {
        const s = task.scheduled_date ? friendlyDate(task.scheduled_date, today) : '';
        return { icon: <CalendarDays size={14} />, text: s, aria: s, danger: !!task.scheduled_date && task.scheduled_date < today && !isFinished(task.status) };
      }
      case 'repeat': {
        const s = describeRecurrence(parseRecurrence(task.recurrence), { lunar: lunarUi, today });
        return { icon: <Repeat size={14} />, text: s, aria: s };
      }
      case 'category': {
        const s = cat ? dataLabel(cat.name) : '';
        const Icon = cat ? typeIcon(cat.icon) : Tag;
        return { icon: <Icon size={14} />, text: s, aria: s, ...(cat?.color ? { color: cat.color } : {}) };
      }
      case 'remind': {
        const s = formatRemindTime(task.remind_time);
        return { icon: <Bell size={14} />, text: s, aria: s };
      }
      case 'group': {
        const s = group?.name ?? '';
        return { icon: group?.icon ? <span className="pchip-emoji">{group.icon}</span> : <Shapes size={14} />, text: s, aria: s };
      }
      case 'people': {
        const s = people.map((p) => p.name).join(tr('、'));
        return { icon: <AvatarStack store={store} people={people.slice(0, 3)} size={16} />, text: s, aria: s };
      }
    }
  };

  /** 清除回默认（提示里可撤销）；焦点交给下一个胶囊或「+」。 */
  const clear = (id: PropId) => {
    let undo: () => void;
    if (id === 'type') {
      const snap = { type_id: task.type_id, library_item_id: task.library_item_id, type_data: task.type_data, body_md: task.body_md };
      store.changeTaskType(task.id, PLAIN_TYPE_ID);
      undo = () => store.updateTask(task.id, snap);
    } else if (id === 'people') {
      const ids = [...linked];
      for (const pid of ids) store.unlinkPerson(task.id, pid);
      undo = () => ids.forEach((pid) => store.linkPerson(task.id, pid));
    } else {
      const p = clearPatch(id)!;
      const snap = Object.fromEntries(Object.keys(p).map((k) => [k, task[k as keyof Task]])) as Partial<Task>;
      patch(p);
      undo = () => patch(snap);
    }
    ui.toast({ message: tr('已清除「{label}」', { label: propLabel(id) }), actions: [{ label: tr('撤销'), onPress: undo }] }, 5000);
    const i = shown.indexOf(id);
    const next = shown[i + 1] ?? shown[i - 1];
    requestAnimationFrame(() => {
      const el = (next && next !== id ? chipRefs.current.get(next) : null) ?? addRef.current ?? rowRef.current?.querySelector<HTMLElement>('.pchip-add');
      el?.focus();
    });
  };

  const openFor = (id: PropId, via: 'chip' | 'add', el: HTMLElement | null) => {
    anchor.current = el;
    setOpen({ id, via });
  };

  const close = () => setOpen(null);

  const picker = (id: PropId): ReactNode => {
    switch (id) {
      case 'type':
        return (
          <div className="pop-section">
            <TypeGrid
              types={store.pickableTypes()}
              value={task.type_id ?? PLAIN_TYPE_ID}
              onChange={(tid) => {
                // 改类型清空原来的资料（Rei 2026-10-16），新类型从「未选」开始；正文为空时套用模板
                store.changeTaskType(task.id, tid);
                close();
              }}
            />
          </div>
        );
      case 'mode':
        return (
          <div className="pop-section">
            <CompletionChoice compact value={task.completion_mode} onChange={(m) => patch(modeDefaults(m, task))} />
            <CompletionSentence value={task} today={today} onChange={(p) => patch(p)} />
          </div>
        );
      case 'date':
        return (
          <DatePanel
            value={task.scheduled_date}
            today={today}
            onChange={(v) => {
              patch({ scheduled_date: v });
              close();
            }}
          />
        );
      case 'repeat':
        return (
          <div className="pop-section">
            <RepeatEditor value={task.recurrence} today={today} onChange={(r) => patch({ recurrence: r })} />
          </div>
        );
      case 'category':
        return (
          <div className="pop-section">
            <CategoryPicker
              store={store}
              value={task.checkin_category_id}
              onChange={(cid) => {
                patch({ checkin_category_id: cid });
                close();
              }}
            />
          </div>
        );
      case 'remind':
        return (
          <RemindPanel
            value={task.remind_time}
            task={task}
            onChange={(v) => {
              patch({ remind_time: v });
              close();
            }}
          />
        );
      case 'group':
        return (
          <GroupList
            store={store}
            value={task.group_id}
            onChange={(gid) => {
              patch({ group_id: gid });
              close();
            }}
          />
        );
      case 'people':
        return (
          <>
            <PeopleList
              store={store}
              value={linked}
              onChange={(ids) => {
                const next = new Set(ids);
                for (const pid of linked) if (!next.has(pid)) store.unlinkPerson(task.id, pid);
                for (const pid of ids) if (!linked.includes(pid)) store.linkPerson(task.id, pid);
              }}
            />
            {linked.length > 0 && (
              <div className="pop-foot">
                <RacButton
                  className="link-btn"
                  onPress={() => {
                    close();
                    clear('people');
                  }}
                >
                  <X size={13} aria-hidden />
                  {tr('清除')}
                </RacButton>
              </div>
            )}
          </>
        );
    }
  };

  const empty = shown.length === 0;
  // 从「+」打开最后一项时先别藏「+」（弹层还挂在它上面）
  const showAdd = missing.length > 0 || open?.via === 'add';

  return (
    <div ref={rowRef} className={`pchips${empty ? ' is-empty' : ''}`} role="group" aria-label={tr('属性')}>
      {shown.map((id) => {
        const v = view(id);
        const label = propLabel(id);
        return (
          <span key={id} className={`pchip-wrap${v.danger ? ' is-danger' : ''}${v.color ? ' has-color' : ''}`} style={v.color ? ({ '--chip-color': v.color } as CSSProperties) : undefined}>
            <RacButton
              ref={(el: HTMLButtonElement | null) => {
                if (el) chipRefs.current.set(id, el);
                else chipRefs.current.delete(id);
              }}
              className={`pchip pchip-${id}`}
              aria-label={tr('{label}：{value}', { label, value: v.aria })}
              aria-haspopup="dialog"
              aria-expanded={open?.id === id}
              onPress={(e) => openFor(id, 'chip', e.target as HTMLElement)}
              onKeyDown={(e) => {
                if (e.key === 'Backspace' || e.key === 'Delete') {
                  e.preventDefault();
                  clear(id);
                } else e.continuePropagation();
              }}
            >
              <span className="pchip-icon" aria-hidden>
                {v.icon}
              </span>
              <span className="pchip-text">{v.text}</span>
            </RacButton>
            <RacButton className="pchip-x" excludeFromTabOrder aria-label={tr('清除{label}', { label })} onPress={() => clear(id)}>
              <X size={10} strokeWidth={3} aria-hidden />
            </RacButton>
          </span>
        );
      })}
      {showAdd && (
        <MenuTrigger>
          <RacButton ref={addRef} className={`pchip pchip-add${empty ? ' has-label' : ''}`} aria-label={tr('添加属性')}>
            <Plus size={14} aria-hidden />
            {empty && <span className="pchip-text">{tr('添加属性')}</span>}
          </RacButton>
          <Popover className="popover menu-popover" placement="bottom start" offset={4}>
            <Menu
              className="menu"
              aria-label={tr('添加属性')}
              onAction={(k) => {
                const id = k as PropId;
                // 等菜单收起、焦点回到「+」后再打开那项的选择器
                window.setTimeout(() => openFor(id, 'add', addRef.current), 0);
              }}
            >
              {missing.map((id) => (
                <MenuItem key={id} id={id} className="menu-item" textValue={propLabel(id)}>
                  {addIcon(id, task)}
                  <span>{propLabel(id)}</span>
                </MenuItem>
              ))}
            </Menu>
          </Popover>
        </MenuTrigger>
      )}
      {open && (
        <Popover
          triggerRef={anchor as RefObject<HTMLElement>}
          isOpen
          onOpenChange={(o) => !o && close()}
          className={`popover popover-panel${WIDE.has(open.id) || open.id === 'people' ? ' is-wide' : ''}`}
          placement="bottom start"
          offset={6}
        >
          <Dialog className="popover-dialog" aria-label={propLabel(open.id)}>
            {picker(open.id)}
          </Dialog>
        </Popover>
      )}
    </div>
  );
}

/** 「+」菜单里每项的图标（同胶囊）。 */
function addIcon(id: PropId, task: Task): ReactNode {
  switch (id) {
    case 'type': {
      const Icon = typeIcon('file-text');
      return <Icon size={16} />;
    }
    case 'mode': {
      const Icon = MODE_ICON[task.completion_mode];
      return <Icon size={16} />;
    }
    case 'date':
      return <CalendarDays size={16} />;
    case 'repeat':
      return <Repeat size={16} />;
    case 'category':
      return <Tag size={16} />;
    case 'remind':
      return <Bell size={16} />;
    case 'group':
      return <Shapes size={16} />;
    case 'people':
      return <Users size={16} />;
  }
}
