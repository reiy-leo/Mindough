import type { ReactNode } from 'react';
import { Button as RacButton, Checkbox } from 'react-aria-components';
import { Check, Link2, Lock, Repeat, Sun, SunDim, X } from 'lucide-react';
import { describeRecurrence, isCheckInTask, parseRecurrence, relativeDayZh, toDateKey, type Store, type Task } from '@mindough/core';
import { useUi } from '../lib/ui';
import { toggleDone, toggleMyDay } from '../lib/actions';
import { STATE_CLASS, viewOf } from '../lib/view';
import { typeIcon } from '../lib/icons';
import { AvatarStack } from './Avatar';
import { CheckInControl } from './CheckInControl';
import { ItemArt } from './library/Library';

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
  if (name) return <ItemArt src={null} name={name} shape={layout === 'poster' ? 'poster' : layout === 'banner' ? 'banner' : 'square'} className={`thumb thumb-${layout}`} />;
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
  const checkIn = isCheckInTask(task);
  const closed = task.status === '关闭';
  const done = !closed && (doneOverride ?? task.status === '完成');
  const inDay = store.isInMyDay(task.id, today);
  const state = v.derived?.state;
  const rec = parseRecurrence(task.recurrence);
  const TypeIcon = typeIcon(v.type?.icon);
  const isCheckInRow = checkIn && (task.completion_mode !== 'once' || !!rec);
  const relatedCount = store.relatedTasks(task.id).length;

  return (
    <div className={`task-row ${STATE_CLASS[state ?? ''] ?? ''}${done ? ' is-done' : ''}${closed ? ' is-closed' : ''}`} data-task-id={task.id}>
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
      <RacButton className="row-main" onPress={() => ui.openEditor(task.id)}>
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
          {showDate && task.scheduled_date && <span className={`meta-date${task.scheduled_date < today && !done && !closed ? ' is-overdue' : ''}`}>{relativeDayZh(task.scheduled_date, today)}</span>}
          {rec && (
            <span className="meta-rec">
              <Repeat size={11} />
              {describeRecurrence(rec)}
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
    </div>
  );
}
