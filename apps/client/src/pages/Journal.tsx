/**
 * 日记页（方案 docs/JOURNAL.md，Rei 2026-10-17 已审）：一天一篇。
 * 桌面：左边月历 + 这个月的列表，右边那天的日记（日期、心情、编辑器、字数）。
 * 手机：进来就是那天的日记；顶部「‹ 日期 ›」前后一天，「月历」切到月历 + 列表，点一天回来。
 * 「今天」按「一天从几点开始」算；将来的日子不能写；「这一天」汇总不放在日记里（Rei 2026-10-17）。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button as RacButton } from 'react-aria-components';
import { CalendarClock, CalendarDays, ChevronLeft, ChevronRight, NotebookPen, Trash2 } from 'lucide-react';
import { addDays, canWriteJournal, conflictSummary, formatDate, isDateKey, journalWordCount, mergeJournalConflict, relativeDayZh, type JournalEntry } from '@mindough/core';
import { useNow, useStore } from '../store/StoreProvider';
import { useSettings } from '../lib/settings';
import { navigate } from '../lib/router';
import { useUi } from '../lib/ui';
import { PageHeader } from '../components/PageHeader';
import { Button, ConfirmDialog, Empty } from '../ui/primitives';
import { LazyMdEditor } from '../components/editor/LazyMdEditor';
import { MoodPicker } from '../components/journal/MoodPicker';
import { JournalCalendar, JournalMonthList } from '../components/journal/JournalCalendar';
import { tr } from '../lib/i18n';

/** 自动保存：停手这么久就存一次（另外离开编辑器、换一天、关掉页面时也存）。 */
const AUTOSAVE_MS = 1200;

export function JournalPage({ date: wanted }: { date?: string }) {
  const store = useStore();
  const now = useNow();
  const { layout } = useSettings();
  const today = store.journalToday(now);
  const date = wanted && isDateKey(wanted) ? wanted : today;
  const future = !canWriteJournal(date, today);
  const [month, setMonth] = useState(date.slice(0, 7));
  const [browsing, setBrowsing] = useState(false);
  useEffect(() => setMonth((m) => (m === date.slice(0, 7) ? m : date.slice(0, 7))), [date]);

  const all = store.list('journal_entry');
  const byDate = useMemo(() => new Map(all.map((e) => [e.date, e])), [all]);
  const go = (d: string) => {
    setBrowsing(false);
    navigate(d === today ? { page: 'journal' } : { page: 'journal', date: d });
  };
  const mobile = layout === 'mobile';
  // #/journal/不是日期：换成今天并提示一句
  const ui = useUi();
  useEffect(() => {
    if (wanted && !isDateKey(wanted)) {
      ui.toast({ tone: 'error', message: tr('没有这一天：{date}', { date: wanted }) });
      navigate({ page: 'journal' });
    }
  }, [wanted]); // eslint-disable-line react-hooks/exhaustive-deps

  const calendar = (
    <div className="journal-side">
      <JournalCalendar month={month} onMonth={setMonth} selected={date} today={today} entries={byDate} onSelect={go} />
      <JournalMonthList month={month} entries={all} selected={date} onSelect={go} />
    </div>
  );

  const header = (
    <PageHeader
      title={tr('日记')}
      icon={<NotebookPen size={22} />}
      actions={
        <>
          {mobile && (
            <Button variant={browsing ? 'tonal' : 'secondary'} onPress={() => setBrowsing((b) => !b)} aria-pressed={browsing}>
              <CalendarDays size={15} /> {tr('月历')}
            </Button>
          )}
          <Button variant="secondary" isDisabled={date === today && !browsing} onPress={() => go(today)}>
            {tr('今天')}
          </Button>
        </>
      }
    />
  );

  return (
    <div className={`page journal-page${mobile ? ' is-mobile' : ''}`}>
      {header}
      <div className="journal-layout">
        {(!mobile || browsing) && calendar}
        {(!mobile || !browsing) && (
          <section className="journal-main card" aria-label={formatDate(date, { year: true })}>
            <DayNav date={date} today={today} onGo={go} />
            {future ? (
              <Empty icon={<CalendarClock size={28} />} title={tr('这天还没到')} hint={tr('将来的日子还不能写。')} />
            ) : (
              <Entry key={date} date={date} today={today} entry={byDate.get(date)} />
            )}
          </section>
        )}
      </div>
    </div>
  );
}

function DayNav({ date, today, onGo }: { date: string; today: string; onGo: (d: string) => void }) {
  const rel = relativeDayZh(date, today);
  const isRel = rel !== formatDate(date);
  return (
    <div className="journal-daynav">
      <RacButton className="icon-btn" aria-label={tr('前一天')} onPress={() => onGo(addDays(date, -1))}>
        <ChevronLeft size={18} />
      </RacButton>
      <div className="journal-date">
        <h2 className="journal-date-title">{formatDate(date, { year: true })}</h2>
        {isRel && <span className="journal-date-rel">{rel}</span>}
      </div>
      <RacButton className="icon-btn" aria-label={tr('后一天')} isDisabled={date >= today} onPress={() => onGo(addDays(date, 1))}>
        <ChevronRight size={18} />
      </RacButton>
    </div>
  );
}

/** 那天的日记：心情 + 编辑器。打字先记在本地，停手、离开编辑器、换一天时存。 */
function Entry({ date, today, entry }: { date: string; today: string; entry: JournalEntry | undefined }) {
  const store = useStore();
  const [body, setBody] = useState(entry?.body_md ?? '');
  const [confirm, setConfirm] = useState(false);
  const latest = useRef(body);
  latest.current = body;
  /** 最近一次存下去（或从库里读到）的正文。 */
  const saved = useRef(entry?.body_md ?? '');
  const editing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const commit = () => {
    clearTimeout(timer.current);
    const text = latest.current;
    if (text === saved.current) return;
    saved.current = text;
    try {
      store.setJournal(date, { body_md: text });
    } catch (e) {
      console.error(e);
    }
  };

  // 别处改了这天的日记（同步拉下来、另一个窗口）：没在写就跟上；正在写就把那版里这边没有的收进折叠块，不丢字
  const remote = entry?.body_md ?? '';
  useEffect(() => {
    if (remote === saved.current) return;
    if (!editing.current || latest.current === saved.current) {
      saved.current = remote;
      setBody(remote);
      return;
    }
    const merged = mergeJournalConflict(latest.current, remote, conflictSummary(entry?.updated_at ?? ''));
    saved.current = remote;
    if (merged !== null) setBody(merged);
  }, [remote]); // eslint-disable-line react-hooks/exhaustive-deps

  // 离开（换一天、关页面）前存
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      if (latest.current !== saved.current) {
        try {
          store.setJournal(date, { body_md: latest.current });
        } catch {
          /* 将来的日子：本来就写不了 */
        }
      }
    },
    [store, date],
  );
  useEffect(() => {
    const on = () => commit();
    window.addEventListener('pagehide', on);
    return () => window.removeEventListener('pagehide', on);
  });

  const words = journalWordCount(body);
  return (
    <div className="journal-entry">
      <MoodPicker
        value={entry?.mood ?? null}
        onChange={(mood) => {
          clearTimeout(timer.current);
          saved.current = latest.current;
          store.setJournal(date, { mood, body_md: latest.current });
        }}
      />
      <div className="journal-editor">
        <LazyMdEditor
          className="journal-md"
          label={tr('日记内容')}
          placeholder={date === today ? tr('写几句今天的事') : tr('这天还没写')}
          value={body}
          onChange={(v) => {
            editing.current = true;
            setBody(v);
            latest.current = v;
            clearTimeout(timer.current);
            timer.current = setTimeout(commit, AUTOSAVE_MS);
          }}
          onBlur={() => {
            editing.current = false;
            commit();
          }}
          onEscape={() => {
            editing.current = false;
            commit();
            (document.activeElement as HTMLElement | null)?.blur();
          }}
        />
      </div>
      <div className="journal-foot">
        <span className="muted small">{words > 0 ? tr('{n} 字', { n: words }) : tr('还没写')}</span>
        {entry && (
          <RacButton className="icon-btn" aria-label={tr('删除这天的日记')} onPress={() => setConfirm(true)}>
            <Trash2 size={16} />
          </RacButton>
        )}
      </div>
      <ConfirmDialog
        isOpen={confirm}
        onOpenChange={setConfirm}
        title={tr('删除这天的日记？')}
        message={tr('「{date}」的日记会被删除，不能恢复。', { date: formatDate(date, { year: true }) })}
        confirmLabel={tr('删除')}
        danger
        onConfirm={() => {
          clearTimeout(timer.current);
          saved.current = '';
          latest.current = '';
          setBody('');
          store.deleteJournal(date);
        }}
      />
    </div>
  );
}
