import { useCallback, useMemo, useState } from 'react';
import { Button as RacButton } from 'react-aria-components';
import { CalendarCheck2, Flame, Hourglass, Plus, Timer } from 'lucide-react';
import {
  buildRatioIndex,
  describeRecurrence,
  dueToday,
  formatDateZh,
  formatRecurrence,
  isFinished,
  parseRecurrence,
  taskStreak,
  toDateKey,
  type DateKey,
  type Task,
} from '@mindough/core';
import { useNow, useStore } from '../store/StoreProvider';
import { CategoryLabel, NO_CATEGORY } from '../components/CheckInCategory';
import { CategoryManager } from '../components/CategoryManager';
import { useUi } from '../lib/ui';
import { useSettings } from '../lib/settings';
import { Button, ChipPicker, Empty, Section, Segmented } from '../ui/primitives';
import { Heatmap } from '../components/Heatmap';
import { CheckInControl } from '../components/CheckInControl';
import { PageHeader } from '../components/PageHeader';
import { titleOf } from '../lib/view';
import { typeIcon } from '../lib/icons';

import { tr, trc } from '../lib/i18n';
import { trx } from '../lib/trx';
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

  const [cat, setCat] = useState<string>('all');
  const [managing, setManaging] = useState(false);
  const [arrange, setArrange] = useState<'today' | 'category'>('today');
  const allRecurring = tasks.filter((t) => parseRecurrence(t.recurrence) && !isFinished(t.status));
  const catOf = (t: Task) => store.get('checkin_category', t.checkin_category_id);
  // 筛选标签：只列出有重复任务的分类（按分类顺序），有未分类的再加一个“未分类”
  const usedCats = store.checkInCategories(true).filter((c) => allRecurring.some((t) => t.checkin_category_id === c.id));
  const hasUncategorized = allRecurring.some((t) => !catOf(t));
  const recurring = cat === 'all' ? allRecurring : allRecurring.filter((t) => (cat === NO_CATEGORY ? !catOf(t) : t.checkin_category_id === cat));
  const dueNow = recurring.filter((t) => dueToday(t, today));
  const others = recurring.filter((t) => !dueToday(t, today));
  const metToday = dueNow.filter((t) => store.progress(t.id, today)?.met).length;
  const running = tasks.filter((t) => t.completion_mode === 'timer' && store.progress(t.id, today)?.running);
  const countdowns = tasks.filter((t) => t.completion_mode === 'countdown' && t.target_date && t.status !== '关闭');
  const streaks = recurring.map((t) => taskStreak(t, store.checkInsOf(t.id), now)?.current ?? 0);
  const best = Math.max(0, ...streaks);
  const title = (t: Task) => titleOf(store, t);

  const row = (t: Task) => {
    const s = taskStreak(t, store.checkInsOf(t.id), now);
    const type = store.get('task_type', t.type_id);
    const color = type?.color && type.layout !== 'text' ? type.color : undefined;
    return (
      <div key={t.id} className={`habit-row${ui.editingId === t.id ? ' is-selected' : ''}`} data-task-id={t.id}>
        <RacButton className="habit-main" aria-current={ui.editingId === t.id ? 'true' : undefined} onPress={() => ui.openEditor(t.id)}>
          <span className="habit-title">{title(t)}</span>
          <span className="habit-meta">
            {arrange !== 'category' && catOf(t) && <CategoryLabel c={catOf(t)!} size={12} />}
            {describeRecurrence(parseRecurrence(t.recurrence))}
            {s && (
              <span className="habit-streak">
                <Flame size={12} className={s.current > 0 ? 'flame-on' : ''} />
                {tr('连续 {current} · 最长 {best}', { current: s.current, best: s.best })}
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
          label={tr('{title} 的打卡记录', { title: title(t) })}
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
        title={trc('导航', '打卡')}
        subtitle={tr('今天 {metToday}/{length} 已完成 · 最长连续 {best} 天', { metToday, length: dueNow.length, best })}
        icon={<CalendarCheck2 size={22} />}
        actions={
          <Button
            variant="primary"
            onPress={() =>
              ui.openQuickCreate({ recurrence: formatRecurrence({ kind: 'daily' }), checkin_category_id: cat !== 'all' && cat !== NO_CATEGORY ? cat : null })
            }
          >
            <Plus size={16} />
            {tr('新建打卡')}</Button>
        }
      />

      <section className="card heatmap-card">
        <div className="heatmap-card-head">
          <span className="section-title">{tr('过去一年')}</span>
          <span className="muted small">{tr('每格是一天，颜色越深，那天完成得越多')}</span>
        </div>
        <Heatmap end={today} ratioFor={dayRatio} label={tr('过去一年的打卡热力图')} />
      </section>

      {allRecurring.length > 0 && (
        <div className="filter-row checkin-filters">
          <ChipPicker
            label={tr('按打卡分类筛选')}
            value={cat}
            onChange={setCat}
            options={[
              { id: 'all', label: tr('全部 {length}', { length: allRecurring.length }) },
              ...usedCats.map((c) => ({ id: c.id, label: <CategoryLabel c={c} />, color: c.color })),
              ...(hasUncategorized ? [{ id: NO_CATEGORY, label: tr('未分类') }] : []),
            ]}
          />
          <RacButton className="btn btn-quiet filter-edit" onPress={() => setManaging(true)}>
            {tr('编辑')}</RacButton>
          <Segmented
            label={tr('排列方式')}
            value={arrange}
            onChange={setArrange}
            options={[
              { id: 'today', label: tr('按今天') },
              { id: 'category', label: tr('按分类') },
            ]}
          />
        </div>
      )}

      {arrange === 'category' ? (
        <>
          {[...usedCats.map((c) => ({ key: c.id, c })), { key: NO_CATEGORY, c: undefined }].map(({ key, c }) => {
            const list = recurring.filter((t) => (c ? t.checkin_category_id === c.id : !catOf(t)));
            if (!list.length) return null;
            // 分类内：今天要打卡的在前
            list.sort((a, b) => Number(dueToday(b, today)) - Number(dueToday(a, today)));
            return (
              <Section key={key} title={c ? <CategoryLabel c={c} size={15} /> : tr('未分类')} extra={<span className="muted small">{tr('{length} 项', { length: list.length })}</span>}>
                <div className="habit-list">{list.map(row)}</div>
              </Section>
            );
          })}
          {!recurring.length && <Empty title={tr('这个分类下还没有重复任务')} />}
        </>
      ) : (
        <>
      {running.length > 0 && (
        <Section title={<><Timer size={15} /> {tr('正在计时')}</>}>
          <div className="habit-list">{running.map(row)}</div>
        </Section>
      )}

      <Section title={<><Flame size={15} /> {tr('今天要打卡')}</>}>
        {dueNow.length ? <div className="habit-list">{dueNow.filter((t) => !running.includes(t)).map(row)}</div> : <Empty title={tr('今天没有要打卡的')} />}
      </Section>

      {others.length > 0 && (
        <Section title={tr('其他打卡')}>
          <div className="habit-list">{others.map(row)}</div>
        </Section>
      )}
        </>
      )}

      {countdowns.length > 0 && (
        <Section title={<><Hourglass size={15} /> {tr('倒数日')}</>}>
          <div className="countdown-grid">
            {countdowns.map((t) => {
              const p = store.progress(t.id, today);
              const n = p?.value ?? 0;
              const type = store.get('task_type', t.type_id);
              const Icon = typeIcon(type?.icon);
              return (
                <RacButton key={t.id} className={`card countdown-card${ui.editingId === t.id ? ' is-selected' : ''}`} data-task-id={t.id} aria-current={ui.editingId === t.id ? 'true' : undefined} onPress={() => ui.openEditor(t.id)}>
                  <span className="countdown-title">
                    {type && type.layout !== 'text' && <Icon size={14} style={{ color: type.color }} />}
                    {title(t)}
                  </span>
                  <span className="countdown-num">
                    {n === 0 ? <b>{tr('今天')}</b> : n > 0 ? trx('还有 {n} 天', { n: <b>{n}</b> }, { count: n }, { wrap: 'countdown-affix' }) : trx('已过 {n} 天', { n: <b>{-n}</b> }, { count: -n }, { wrap: 'countdown-affix' })}
                  </span>
                  <span className="countdown-date">{formatDateZh(t.target_date!)}</span>
                </RacButton>
              );
            })}
          </div>
        </Section>
      )}
      <CategoryManager isOpen={managing} onOpenChange={setManaging} />
    </div>
  );
}