import { useCallback, useMemo, useState, type CSSProperties } from 'react';
import { Button as RacButton } from 'react-aria-components';
import { CalendarCheck2, Flame, Plus, Timer } from 'lucide-react';
import {
  buildRatioIndex,
  describeRecurrence,
  dueToday,
  formatRecurrence,
  isFinished,
  parseRecurrence,
  taskStreak,
  toDateKey,
  type DateKey,
  type Task,
} from '@mindough/core';
import { useNow, useStore } from '../store/StoreProvider';
import { CategoryLabel, CategoryLabels, NO_CATEGORY, openCategoryPage } from '../components/CategoryPicker';
import { useUi } from '../lib/ui';
import { useSettings } from '../lib/settings';
import { Button, ChipPicker, Empty, Section, Segmented, TipButton } from '../ui/primitives';
import { isHeatmapOpen, toggleHeatmapOpen } from '../lib/habit-heatmap';
import { Heatmap } from '../components/Heatmap';
import { CheckInControl } from '../components/CheckInControl';
import { PageHeader } from '../components/PageHeader';
import { titleOf } from '../lib/view';

import { tr, trc } from '../lib/i18n';
import { useLunarUi } from '../lib/lunar';
export function CheckInsPage() {
  const store = useStore();
  const ui = useUi();
  const { layout, settings, set } = useSettings();
  const now = useNow();
  const today = toDateKey(now);
  const lunarUi = useLunarUi();
  const tasks = store.tasks();
  const checkIns = store.list('check_in');
  const idx = useMemo(() => buildRatioIndex(tasks, checkIns, now), [store.version, today]); // eslint-disable-line react-hooks/exhaustive-deps
  const dayRatio = useCallback((d: DateKey) => idx.dayRatio(d), [idx]);

  const [cat, setCat] = useState<string>('all');
  const [arrange, setArrange] = useState<'today' | 'category'>('today');
  const allRecurring = tasks.filter((t) => parseRecurrence(t.recurrence) && !isFinished(t.status));
  // 类型（Rei 2026-10-26：和项目、倒数日共用一套）：顺着合并找到留下的那个
  const catOf = (t: Task) => store.categoryOf(t);
  // 一件任务能挂几个类型（Rei 2026-10-28）：筛选看挂没挂这个类型；按类型分组时放在第一个类型下面（不重复出现）
  const hasCat = (t: Task, id: string) => store.categoryIdsOfTask(t).includes(id);
  // 筛选标签：只列出有重复任务挂着的类型（按类型顺序，不显示的也算，挂着就列），有没类型的再加一个“没有类型”
  const usedCats = store.categories(true).filter((c) => allRecurring.some((t) => hasCat(t, c.id)));
  const hasUncategorized = allRecurring.some((t) => !catOf(t));
  const recurring = cat === 'all' ? allRecurring : allRecurring.filter((t) => (cat === NO_CATEGORY ? !catOf(t) : hasCat(t, cat)));
  const dueNow = recurring.filter((t) => dueToday(t, today));
  const others = recurring.filter((t) => !dueToday(t, today));
  const metToday = dueNow.filter((t) => store.progress(t.id, today)?.met).length;
  const running = tasks.filter((t) => t.completion_mode === 'timer' && store.progress(t.id, today)?.running);
  const streaks = recurring.map((t) => taskStreak(t, store.checkInsOf(t.id), now)?.current ?? 0);
  const best = Math.max(0, ...streaks);
  const title = (t: Task) => titleOf(store, t);

  const row = (t: Task) => {
    const s = taskStreak(t, store.checkInsOf(t.id), now);
    const type = store.get('task_type', t.type_id);
    const color = type?.color && type.layout !== 'text' ? type.color : undefined;
    const open = isHeatmapOpen(settings.habitHeatmapOpen, t.id);
    const heatId = `habit-heat-${t.id}`;
    return (
      <div key={t.id} className={`habit-row${ui.editingId === t.id ? ' is-selected' : ''}${open ? ' is-heat-open' : ''}`} data-task-id={t.id}>
        {/* 左上角圆点：展开 / 收起这张卡片的活动图（只存本机）；和打开详情的按钮分开，点它不会打开详情 */}
        <TipButton
          tip={open ? tr('隐藏活动图') : tr('显示活动图')}
          isExpanded={open}
          controls={open ? heatId : undefined}
          className={`habit-heat-dot${open ? ' is-on' : ''}`}
          onPress={() => set('habitHeatmapOpen', toggleHeatmapOpen(settings.habitHeatmapOpen, t.id))}
        >
          <span className="habit-heat-dot-mark" style={color ? ({ '--heat-color-local': color } as CSSProperties) : undefined} aria-hidden />
        </TipButton>
        <RacButton className="habit-main" aria-current={ui.editingId === t.id ? 'true' : undefined} onPress={() => ui.openEditor(t.id)}>
          <span className="habit-title">{title(t)}</span>
          <span className="habit-meta">
            {arrange !== 'category' && catOf(t) && <CategoryLabels cats={store.categoriesOfTask(t)} size={12} />}
            {describeRecurrence(parseRecurrence(t.recurrence), { lunar: lunarUi, today })}
            {s && (
              <span className="habit-streak">
                <Flame size={12} className={s.current > 0 ? 'flame-on' : ''} />
                {tr('连续 {current} · 最长 {best}', { current: s.current, best: s.best })}
              </span>
            )}
          </span>
        </RacButton>
        <div className="habit-action">
          <CheckInControl store={store} task={t} compact={layout === 'mobile'} />
        </div>
        {open && (
          <div className="habit-heat">
            <Heatmap
              mini
              fit
              id={heatId}
              end={today}
              ratioFor={(d) => idx.taskRatio(t.id, d)}
              color={color}
              label={tr('{title} 的打卡记录', { title: title(t) })}
            />
          </div>
        )}
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
              ui.openQuickCreate({ recurrence: formatRecurrence({ kind: 'daily' }), category_id: cat !== 'all' && cat !== NO_CATEGORY ? cat : null })
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
            label={tr('按类型筛选')}
            value={cat}
            onChange={setCat}
            options={[
              { id: 'all', label: tr('全部 {length}', { length: allRecurring.length }) },
              ...usedCats.map((c) => ({ id: c.id, label: <CategoryLabel c={c} />, color: c.color })),
              ...(hasUncategorized ? [{ id: NO_CATEGORY, label: tr('没有类型') }] : []),
            ]}
          />
          <RacButton className="btn btn-quiet filter-edit" onPress={openCategoryPage}>
            {tr('编辑')}</RacButton>
          <Segmented
            label={tr('排列方式')}
            value={arrange}
            onChange={setArrange}
            options={[
              { id: 'today', label: tr('按今天') },
              { id: 'category', label: tr('按类型') },
            ]}
          />
        </div>
      )}

      {arrange === 'category' ? (
        <>
          {[...usedCats.map((c) => ({ key: c.id, c })), { key: NO_CATEGORY, c: undefined }].map(({ key, c }) => {
            const list = recurring.filter((t) => (c ? catOf(t)?.id === c.id : !catOf(t)));
            if (!list.length) return null;
            // 同一类型里：今天要打卡的在前
            list.sort((a, b) => Number(dueToday(b, today)) - Number(dueToday(a, today)));
            return (
              <Section key={key} title={c ? <CategoryLabel c={c} size={15} /> : tr('没有类型')} extra={<span className="muted small">{tr('{length} 项', { length: list.length })}</span>}>
                <div className="habit-list">{list.map(row)}</div>
              </Section>
            );
          })}
          {!recurring.length && <Empty title={tr('这个类型下还没有重复任务')} />}
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
    </div>
  );
}