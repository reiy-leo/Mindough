import { useCallback, useMemo } from 'react';
import { Button as RacButton } from 'react-aria-components';
import { CalendarCheck2, Flame, Hourglass, Timer } from 'lucide-react';
import {
  buildRatioIndex,
  describeRecurrence,
  dueToday,
  formatDateZh,
  isFinished,
  parseRecurrence,
  taskStreak,
  taskTitle,
  toDateKey,
  type DateKey,
  type Task,
} from '@mindough/core';
import { useNow, useStore } from '../store/StoreProvider';
import { useUi } from '../lib/ui';
import { useSettings } from '../lib/settings';
import { Empty, Section } from '../ui/primitives';
import { Heatmap } from '../components/Heatmap';
import { CheckInControl } from '../components/CheckInControl';
import { PageHeader } from '../components/PageHeader';
import { resolver } from '../lib/view';
import { typeIcon } from '../lib/icons';

export function CheckInsPage() {
  const store = useStore();
  const ui = useUi();
  const { layout } = useSettings();
  const now = useNow();
  const today = toDateKey(now);
  const tasks = store.tasks();
  const checkIns = store.list('check_in');
  const idx = useMemo(() => buildRatioIndex(tasks, checkIns, now), [store.version, today]); // eslint-disable-line react-hooks/exhaustive-deps
  const dayRatio = useCallback((d: DateKey) => idx.dayRatio(d), [idx]);

  const recurring = tasks.filter((t) => parseRecurrence(t.recurrence) && !isFinished(t.status));
  const dueNow = recurring.filter((t) => dueToday(t, today));
  const others = recurring.filter((t) => !dueToday(t, today));
  const metToday = dueNow.filter((t) => store.progress(t.id, today)?.met).length;
  const running = tasks.filter((t) => t.completion_mode === 'timer' && store.progress(t.id, today)?.running);
  const countdowns = tasks.filter((t) => t.completion_mode === 'countdown' && t.target_date && t.status !== '关闭');
  const streaks = recurring.map((t) => taskStreak(t, store.checkInsOf(t.id), now)?.current ?? 0);
  const best = Math.max(0, ...streaks);
  const title = (t: Task) => taskTitle(t, store.get('task_type', t.type_id), resolver(store));

  const row = (t: Task) => {
    const s = taskStreak(t, store.checkInsOf(t.id), now);
    const type = store.get('task_type', t.type_id);
    const color = type?.color && type.layout !== 'text' ? type.color : undefined;
    return (
      <div key={t.id} className="habit-row">
        <RacButton className="habit-main" onPress={() => ui.openEditor(t.id)}>
          <span className="habit-title">{title(t)}</span>
          <span className="habit-meta">
            {describeRecurrence(parseRecurrence(t.recurrence))}
            {s && (
              <span className="habit-streak">
                <Flame size={12} className={s.current > 0 ? 'flame-on' : ''} />
                连续 {s.current} · 最长 {s.best}
              </span>
            )}
          </span>
        </RacButton>
        <Heatmap
          mini
          end={today}
          weeks={layout === 'mobile' ? 12 : 20}
          ratioFor={(d) => idx.taskRatio(t.id, d)}
          color={color}
          label={`${title(t)} 的打卡记录`}
        />
        <div className="habit-action">
          <CheckInControl store={store} task={t} compact={layout === 'mobile'} />
        </div>
      </div>
    );
  };

  return (
    <div className="page">
      <PageHeader
        title="打卡"
        subtitle={`今天 ${metToday}/${dueNow.length} 已完成 · 最长连续 ${best} 天`}
        icon={<CalendarCheck2 size={22} />}
      />

      <section className="card heatmap-card">
        <div className="heatmap-card-head">
          <span className="section-title">过去一年</span>
          <span className="muted small">每格一天，颜色越深当天完成比例越高</span>
        </div>
        <Heatmap end={today} ratioFor={dayRatio} label="过去一年的打卡热力图" />
      </section>

      {running.length > 0 && (
        <Section title={<><Timer size={15} /> 正在计时</>}>
          <div className="habit-list">{running.map(row)}</div>
        </Section>
      )}

      <Section title={<><Flame size={15} /> 今天要打卡</>}>
        {dueNow.length ? <div className="habit-list">{dueNow.filter((t) => !running.includes(t)).map(row)}</div> : <Empty title="今天没有要打卡的" />}
      </Section>

      {others.length > 0 && (
        <Section title="其他重复任务">
          <div className="habit-list">{others.map(row)}</div>
        </Section>
      )}

      {countdowns.length > 0 && (
        <Section title={<><Hourglass size={15} /> 倒数日</>}>
          <div className="countdown-grid">
            {countdowns.map((t) => {
              const p = store.progress(t.id, today);
              const n = p?.value ?? 0;
              const type = store.get('task_type', t.type_id);
              const Icon = typeIcon(type?.icon);
              return (
                <RacButton key={t.id} className="card countdown-card" onPress={() => ui.openEditor(t.id)}>
                  <span className="countdown-title">
                    {type && type.layout !== 'text' && <Icon size={14} style={{ color: type.color }} />}
                    {title(t)}
                  </span>
                  <span className="countdown-num">
                    <span className="countdown-prefix">{n > 0 ? '还有' : n === 0 ? '' : '已过'}</span>
                    <b>{n === 0 ? '今天' : Math.abs(n)}</b>
                    {n !== 0 && <span className="countdown-unit">天</span>}
                  </span>
                  <span className="countdown-date">{formatDateZh(t.target_date!)}</span>
                </RacButton>
              );
            })}
          </div>
        </Section>
      )}
    </div>
  );
}
