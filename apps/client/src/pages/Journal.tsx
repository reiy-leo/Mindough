/**
 * 日记页（2026-10-28 改成 Feed 流，docs/JOURNAL.md 顶部「2026-10-28 改版：Feed 流」）。
 * Rei：「我更喜欢Feed流，一天可以添加很多条。每一条都可以标记心情」「两栏，左侧顶部显示activity图，点击可以切换」
 * 「左侧除了activity图，还可以显示一个心情列表」。
 * - 宽屏两栏：左边是活动图（格子颜色 = 当天各条心情色混合）+ 心情列表；右边是输入框 + 按天分组的条目。
 * - 点活动图的一天：右边只看那天（再点一次或点「全部」回来）；点心情列表的一行：只看这个心情，能和某天叠加。
 * - 选中的不是今天时不显示输入框（过去不补写，将来不能写）。
 * - 窄屏：活动图、心情在上，输入框和条目在下。
 * 路由 #/journal/<日期> = 选中那天（深链接 mindough://journal/YYYY-MM-DD 也是）。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button as RacButton } from 'react-aria-components';
import { NotebookPen, Search, X } from 'lucide-react';
import { filterPosts, groupPostsByDay, isDateKey, journalHeatRange, moodCounts, moodLabel, postsByDay, type MoodId } from '@mindough/core';
import { useNow, useStore } from '../store/StoreProvider';
import { useSettings } from '../lib/settings';
import { navigate } from '../lib/router';
import { useUi } from '../lib/ui';
import { onJournalCompose, takeJournalCompose } from '../lib/journal-compose';
import { PageHeader } from '../components/PageHeader';
import { Button, Empty } from '../ui/primitives';
import { JournalHeatmap } from '../components/journal/JournalHeatmap';
import { MoodList } from '../components/journal/MoodList';
import { JournalComposer, type ComposerHandle } from '../components/journal/JournalComposer';
import { JournalFeed, dayTitle } from '../components/journal/JournalFeed';
import { MoodIcon } from '../components/journal/MoodIcon';
import { tr } from '../lib/i18n';

export function JournalPage({ date: wanted }: { date?: string }) {
  const store = useStore();
  const now = useNow();
  const { layout } = useSettings();
  const ui = useUi();
  const mobile = layout === 'mobile';
  const today = store.journalToday(now);
  const day = wanted && isDateKey(wanted) ? wanted : null;
  const [mood, setMood] = useState<string | null>(null);
  const composer = useRef<ComposerHandle>(null);

  // #/journal/不是日期：回到全部并提示一句
  useEffect(() => {
    if (wanted && !isDateKey(wanted)) {
      ui.toast({ tone: 'error', message: tr('没有这一天：{date}', { date: wanted }) });
      navigate({ page: 'journal' });
    }
  }, [wanted]); // eslint-disable-line react-hooks/exhaustive-deps

  // 从小卡、⌘K、提醒进来：输入框拿焦点
  const [focusAsk, setFocusAsk] = useState(() => takeJournalCompose());
  useEffect(() => onJournalCompose(() => setFocusAsk(takeJournalCompose())), []);
  useEffect(() => {
    if (!focusAsk) return;
    setFocusAsk(false);
    requestAnimationFrame(() => composer.current?.focus());
  }, [focusAsk]);

  const all = store.list('journal_post');
  const range = useMemo(() => journalHeatRange(all, today), [all, today]);
  const days = useMemo(() => postsByDay(all), [all]);
  const counts = useMemo(() => moodCounts(all, range), [all, range]);
  const shown = useMemo(() => groupPostsByDay(filterPosts(all, { day, mood })), [all, day, mood]);
  const canWrite = !day || day === today;

  const selectDay = (d: string | null) => navigate(d ? { page: 'journal', date: d } : { page: 'journal' });
  const send = (body: string, m: MoodId | null) => {
    store.addJournalPost({ body_md: body, mood: m });
    // 按心情筛着、发的又不是这个心情：取消筛选，免得刚发的看不见
    if (mood && m !== mood) setMood(null);
  };

  const filtered = !!day || !!mood;
  const filterBar = filtered && (
    <div className="jf-filter" role="status">
      {day && <span className="jf-filter-day">{dayTitle(day, today)}</span>}
      {mood && (
        <RacButton className="jf-filter-chip" aria-label={tr('不按「{mood}」筛', { mood: moodLabel(mood) })} onPress={() => setMood(null)}>
          <MoodIcon mood={mood} size={18} />
          <span>{moodLabel(mood)}</span>
          <X size={13} />
        </RacButton>
      )}
      <span className="grow" />
      <Button
        variant="secondary"
        onPress={() => {
          setMood(null);
          if (day) selectDay(null);
        }}
      >
        {tr('全部')}
      </Button>
    </div>
  );

  const empty = !shown.length && (
    <Empty
      icon={<NotebookPen size={28} />}
      title={
        !all.length
          ? tr('还没有日记')
          : day && mood
            ? tr('这天没有「{mood}」的日记', { mood: moodLabel(mood) })
            : mood
              ? tr('没有「{mood}」的日记', { mood: moodLabel(mood) })
              : day === today
                ? tr('今天还没写')
                : day && day > today
                  ? tr('这天还没到')
                  : tr('这天没写')
      }
      hint={!all.length || day === today ? tr('想到什么就写一条，一天能写很多条。') : undefined}
    />
  );

  const side = (
    <>
      <section className="jf-heat" aria-label={tr('写日记的日子')}>
        <JournalHeatmap days={days} weeks={range.weeks} today={today} selected={day} onSelect={selectDay} />
      </section>
      <MoodList counts={counts} selected={mood} onSelect={setMood} />
    </>
  );
  const main = (
    <>
      {filterBar}
      {canWrite && <JournalComposer ref={composer} onSend={send} />}
      {empty || <JournalFeed groups={shown} today={today} />}
    </>
  );

  if (mobile)
    return (
      <div className="page journal-page jf is-mobile">
        <PageHeader title={tr('日记')} />
        <div className="jf-side">{side}</div>
        <div className="jf-main">{main}</div>
      </div>
    );
  return (
    <div className="page journal-page jf">
      <div className="jf-layout">
        <aside className="jf-side" aria-label={tr('日记概览')}>
          <div className="jf-side-head">
            <h1 className="page-title">{tr('日记')}</h1>
            <span className="grow" />
            <RacButton className="icon-btn" aria-label={tr('搜索')} onPress={() => ui.setPaletteOpen(true)}>
              <Search size={17} />
            </RacButton>
          </div>
          {side}
        </aside>
        <section className="jf-main" aria-label={tr('日记的条目')}>
          <div className="jf-main-inner">{main}</div>
        </section>
      </div>
    </div>
  );
}
