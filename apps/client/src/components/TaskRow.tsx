import { useRef, useState, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
import { Button as RacButton, Checkbox, Menu, MenuItem, Popover, Separator } from 'react-aria-components';
import { Check, Link2, Lock, PanelRight, Repeat, Sun, SunDim, X } from 'lucide-react';
import { describeRecurrence, isCheckInTask, isTaskOverdue, parseRecurrence, timeZoneBadge, toDateKey, type Store, type Task } from '@mindough/core';
import { useUi } from '../lib/ui';
import { toggleDone, toggleMyDay } from '../lib/actions';
import { STATE_CLASS, viewOf } from '../lib/view';
import { rowMenu } from '../lib/task-menu';
import { isDragPress } from '../lib/drag-guard';
import { typeIcon } from '../lib/icons';
import { TaskDateText } from './TaskDateText';
import { useLunarUi } from '../lib/lunar';
import { AvatarStack } from './Avatar';
import { CheckInControl } from './CheckInControl';
import { ItemArt, layoutShape } from './library/Library';

import { dataLabel, tr } from '../lib/i18n';
export interface TaskRowProps {
  store: Store;
  task: Task;
  showGroup?: boolean;
  showDate?: boolean;
  showMyDay?: boolean;
  /** 我的一天里：重复任务按“今天达标”显示勾。 */
  doneOverride?: boolean;
  trailing?: ReactNode;
  /** 打卡任务是否显示行内打卡按钮。 */
  showCheckIn?: boolean;
}

export function TaskThumb({ media, layout, isAvatar, color, icon, name }: { media: string | null; layout: string; isAvatar: boolean; color?: string; icon?: string; name?: string | null }) {
  const Icon = typeIcon(icon);
  if (media) return <img className={`thumb thumb-${isAvatar ? 'avatar' : layout}`} src={media} alt="" />;
  if (layout === 'text') return null;
  // 资料没有图：按名字生成的渐变占位
  if (name) return <ItemArt src={null} name={name} shape={layoutShape(layout)} className={`thumb thumb-${layout}`} />;
  return (
    <span className="thumb thumb-icon" style={{ color }}>
      <Icon size={16} />
    </span>
  );
}

export function TaskRow({ store, task, showGroup = true, showDate = false, showMyDay = true, doneOverride, trailing, showCheckIn = true }: TaskRowProps) {
  const ui = useUi();
  const v = viewOf(store, task);
  const today = toDateKey(store.now());
  const lunarUi = useLunarUi();
  const tzBadge = timeZoneBadge(task, task.scheduled_date);
  const checkIn = isCheckInTask(task);
  const closed = task.status === '关闭';
  const done = !closed && (doneOverride ?? task.status === '完成');
  const inDay = store.isInMyDay(task.id, today);
  const state = v.derived?.state;
  const rec = parseRecurrence(task.recurrence);
  const TypeIcon = typeIcon(v.type?.icon);
  const isCheckInRow = checkIn && (task.completion_mode !== 'once' || !!rec);
  const relatedCount = store.relatedTasks(task.id).length;
  // 三列布局：右列正在显示这件
  const selected = ui.editingId === task.id;

  // 行的右键 / 长按菜单：查看详情 ｜ 加入 / 移出我的一天（Rei 2026-10-25 去掉建议行尾的「+ 加入」后的入口）
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const press = useRef<{ x: number; y: number; timer: number } | null>(null);
  const longPressed = useRef(false);
  const openMenuAt = (x: number, y: number) => {
    // 键盘（菜单键 / Shift+F10）触发时没有坐标：挂在行的右上
    if (!x && !y && rowRef.current) {
      const r = rowRef.current.getBoundingClientRect();
      x = r.right - 16;
      y = r.top + r.height / 2;
    }
    setMenuAt({ x, y });
  };
  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    openMenuAt(e.clientX, e.clientY);
  };
  const cancelPress = () => {
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = null;
  };
  const onPointerDown = (e: PointerEvent) => {
    longPressed.current = false;
    if (e.pointerType !== 'touch') return;
    const { clientX: x, clientY: y } = e;
    cancelPress();
    press.current = {
      x,
      y,
      timer: window.setTimeout(() => {
        press.current = null;
        longPressed.current = true;
        openMenuAt(x, y);
      }, 500),
    };
  };
  const onPointerMove = (e: PointerEvent) => {
    const p = press.current;
    if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 10) cancelPress();
  };

  return (
    <div
      ref={rowRef}
      className={`task-row ${STATE_CLASS[state ?? ''] ?? ''}${done ? ' is-done' : ''}${closed ? ' is-closed' : ''}${selected ? ' is-selected' : ''}`}
      data-task-id={task.id}
      onContextMenu={onContextMenu}
      // 捕获阶段：行里的按钮（React Aria usePress）会拦住冒泡的 pointerdown
      onPointerDownCapture={onPointerDown}
      onPointerMoveCapture={onPointerMove}
      onPointerUpCapture={cancelPress}
      onPointerCancelCapture={cancelPress}
    >
      {isCheckInRow ? (
        <span className="row-lead" aria-hidden>
          {rec ? <Repeat size={17} /> : <TypeIcon size={18} style={{ color: v.type?.color }} />}
        </span>
      ) : (
        <Checkbox
          className={`check${closed ? ' is-closed' : ''}`}
          isSelected={done || closed}
          onChange={() => toggleDone(store, ui, task.id)}
          aria-label={closed ? tr('已关闭，轻点可重新打开') : done ? tr('标为未完成') : tr('标为完成')}
        >
          <span className="check-box" aria-hidden>
            {closed ? <X size={13} strokeWidth={3} /> : <Check size={13} strokeWidth={3} />}
          </span>
        </Checkbox>
      )}
      <TaskThumb media={v.media} layout={v.type?.layout ?? 'text'} isAvatar={v.mediaIsAvatar} color={v.type?.color} icon={v.type?.icon} name={v.artName} />
      <RacButton className="row-main" aria-current={selected ? 'true' : undefined} onPress={() => {
          // 长按出菜单后松手不算点开
          if (longPressed.current) {
            longPressed.current = false;
            return;
          }
          // 拖动排序的尾巴不算点开：不选中、不打开详情（lib/drag-guard）
          if (isDragPress()) return;
          ui.openEditor(task.id);
        }}
      >
        <span className="row-title">{v.title}</span>
        <span className="row-meta">
          {v.type && v.type.layout !== 'text' && (
            <span className="meta-type" style={{ color: v.type.color }}>
              <TypeIcon size={12} />
              {dataLabel(v.type.name)}
            </span>
          )}
          {state === '被阻塞' && (
            <span className="meta-state state-blocked">
              <Lock size={11} />
              {tr('还在等 {length} 件事', { length: v.derived!.missing.length })}</span>
          )}
          {state === '可开始' && store.edges().some((e) => e.succ_id === task.id) && <span className="meta-state state-ready">{tr('可开始')}</span>}
          {task.status === '进行中' && <span className="meta-state state-doing">{tr('进行中')}</span>}
          {closed && <span className="meta-state state-closed">{tr('已关闭')}</span>}
          {showGroup && v.group && (
            <span className="meta-group">
              {v.group.icon} {v.group.name}
            </span>
          )}
          {showDate && task.scheduled_date && (
            <span className={`meta-date${isTaskOverdue(task, store.now(), today) && !done && !closed ? ' is-overdue' : ''}`}>
              <TaskDateText task={task} today={today} relative />
            </span>
          )}
          {/* 按天分组的列表不写日期，但任务时区和设备不同时照样标出偏移（Rei 2026-10-25 任务时区） */}
          {!showDate && tzBadge && <span className="tz-badge" title={tr('时区：{zone}', { zone: task.time_zone ?? '' })}>{tzBadge}</span>}
          {rec && (
            <span className="meta-rec">
              <Repeat size={11} />
              {describeRecurrence(rec, { lunar: lunarUi, today })}
            </span>
          )}
          {relatedCount > 0 && (
            <span className="meta-related" role="img" aria-label={tr('{relatedCount} 件相关任务', { relatedCount })}>
              <Link2 size={11} aria-hidden />
              {relatedCount}
            </span>
          )}
          {v.subtitle && <span className="meta-sub">{v.subtitle}</span>}
        </span>
      </RacButton>
      <AvatarStack store={store} people={v.people.filter((p) => !(v.mediaIsAvatar && v.data.person === p.id))} />
      {isCheckInRow && showCheckIn && <CheckInControl store={store} task={task} compact />}
      {trailing}
      {showMyDay && (
        <RacButton
          className={`icon-btn myday-btn${inDay ? ' is-on' : ''}`}
          aria-label={inDay ? tr('移出我的一天') : tr('加入我的一天')}
          onPress={() => toggleMyDay(store, ui, task.id)}
        >
          {inDay ? <Sun size={17} /> : <SunDim size={17} />}
        </RacButton>
      )}
      {menuAt && (
        <>
          <span ref={anchorRef} className="row-menu-anchor" style={{ left: menuAt.x, top: menuAt.y }} aria-hidden />
          <Popover
            triggerRef={anchorRef}
            isOpen
            onOpenChange={(open) => !open && setMenuAt(null)}
            className="popover menu-popover"
            placement="bottom start"
            offset={2}
          >
            <Menu
              className="menu"
              aria-label={tr('任务操作')}
              autoFocus="first"
              onAction={(k) => {
                setMenuAt(null);
                if (k === 'open') ui.openEditor(task.id);
                else if (k === 'myday') toggleMyDay(store, ui, task.id);
              }}
            >
              {rowMenu(inDay).flatMap((i, n) => [
                ...(i.separator && n > 0 ? [<Separator key={`sep-${i.id}`} className="menu-sep" />] : []),
                <MenuItem key={i.id} id={i.id} className="menu-item" textValue={i.label}>
                  {i.id === 'open' ? <PanelRight size={16} /> : inDay ? <Sun size={16} /> : <SunDim size={16} />}
                  <span>{i.label}</span>
                </MenuItem>,
              ])}
            </Menu>
          </Popover>
        </>
      )}
    </div>
  );
}
