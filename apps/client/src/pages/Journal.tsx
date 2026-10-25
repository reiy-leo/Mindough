/**
 * 日记页（方案 docs/JOURNAL.md；2026-10-25 按改版方案 B 重做，Rei：「按B实现」，见 docs/JOURNAL-REDESIGN.md）。
 * 一天一篇；心情是主角：
 * - 桌面：中间一列是「情绪月历」+「这个月的心情」分布条 + 这个月的列表；右边是那天的日记，
 *   页头按心情色淡淡一层，大号日期，右上角一张大脸（点它打开半圆心情轮换心情），正文大字、留白、没有白框。
 * - 手机：日记首页就是情绪月历，底部「今天 · 满足 · 接着写」；点一天进那篇，左上角回月历。
 * - 还没写的一天：大字问「今天感觉怎么样？」，下面直接是心情轮，再下面就能写；心情可以不选。
 * 「今天」按「一天从几点开始」算；将来的日子不能写；「这一天」汇总不放在日记里（Rei 2026-10-17）。
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Button as RacButton } from 'react-aria-components';
import { CalendarClock, ChevronLeft, ChevronRight, LayoutGrid, PenLine, Search, Smile, Trash2 } from 'lucide-react';
import { addDays, canWriteJournal, conflictSummary, formatDate, hasJournalContent, isDateKey, journalEntryId, journalWordCount, mergeJournalConflict, monthMoodStats, moodLabel, parseDateKey, relativeDayZh, weekdayLabel, type JournalEntry } from '@mindough/core';
import { useNow, useStore } from '../store/StoreProvider';
import { useSettings } from '../lib/settings';
import { navigate } from '../lib/router';
import { useUi } from '../lib/ui';
import { PageHeader } from '../components/PageHeader';
import { Button, ConfirmDialog, Empty } from '../ui/primitives';
import { LazyMdEditor } from '../components/editor/LazyMdEditor';
import { Attachments, DropOverlay, useAddFiles, useFileDrop } from '../components/attachments/Attachments';
import { MoodIcon } from '../components/journal/MoodIcon';
import { MoodWheel } from '../components/journal/MoodWheel';
import { JournalCalendar, JournalMonthList, MoodSummary, monthTitle, moodVar } from '../components/journal/JournalCalendar';
import { tr } from '../lib/i18n';

/** 自动保存：停手这么久就存一次（另外离开编辑器、换一天、关掉页面时也存）。 */
const AUTOSAVE_MS = 1200;

export function JournalPage({ date: wanted }: { date?: string }) {
  const store = useStore();
  const now = useNow();
  const { layout } = useSettings();
  const ui = useUi();
  const mobile = layout === 'mobile';
  const today = store.journalToday(now);
  const valid = !!wanted && isDateKey(wanted);
  const date = valid ? wanted : today;
  // 手机：#/journal 是月历首页，#/journal/<日期> 才是那一篇；桌面两样一起显示
  const home = mobile && !valid;
  const future = !canWriteJournal(date, today);
  const [month, setMonth] = useState(date.slice(0, 7));
  useEffect(() => setMonth((m) => (m === date.slice(0, 7) ? m : date.slice(0, 7))), [date]);

  // 只有附件的日子也算写了（加附件时会建一行空日记）
  const attachedTo = new Map<string, number>();
  for (const a of store.list('attachment')) if (a.owner_type === 'journal') attachedTo.set(a.owner_id, (attachedTo.get(a.owner_id) ?? 0) + 1);
  const attachments = (id: string) => attachedTo.get(id) ?? 0;
  const all = store.list('journal_entry').filter((e) => hasJournalContent(e) || attachedTo.has(e.id));
  const byDate = useMemo(() => new Map(all.map((e) => [e.date, e])), [all]);
  const stats = monthMoodStats(all, month, () => true);
  const go = (d: string) => navigate(d === today && !mobile ? { page: 'journal' } : { page: 'journal', date: d });

  // 附件：拖文件到这天的日记上就加（将来的日子不收）
  const owner = useMemo(() => ({ type: 'journal' as const, id: journalEntryId(date), date }), [date]);
  const dropRef = useRef<HTMLElement>(null);
  const addFiles = useAddFiles(owner);
  const dropping = useFileDrop(dropRef, addFiles, !future && !home);
  // #/journal/不是日期：换成今天并提示一句
  useEffect(() => {
    if (wanted && !isDateKey(wanted)) {
      ui.toast({ tone: 'error', message: tr('没有这一天：{date}', { date: wanted }) });
      navigate({ page: 'journal' });
    }
  }, [wanted]); // eslint-disable-line react-hooks/exhaustive-deps

  const entry = byDate.get(date);
  const side = (
    <>
      <JournalCalendar month={month} onMonth={setMonth} selected={home ? null : date} today={today} entries={byDate} onSelect={go} attachments={attachments} />
      <MoodSummary stats={stats} />
      <JournalMonthList month={month} entries={all} selected={home ? null : date} onSelect={go} attachments={attachments} />
    </>
  );

  if (home) {
    const t = byDate.get(today);
    return (
      <div className="page journal-page is-mobile is-home">
        <PageHeader title={tr('日记')} />
        <div className="journal-side">{side}</div>
        <div className="journal-cta-wrap">
          <RacButton className="journal-cta" onPress={() => go(today)}>
            {t?.mood ? <MoodIcon mood={t.mood} size={24} /> : <PenLine size={18} />}
            <span>{t ? [tr('今天'), t.mood ? moodLabel(t.mood) || t.mood : '', tr('接着写')].filter(Boolean).join(' · ') : tr('写今天的日记')}</span>
          </RacButton>
        </div>
      </div>
    );
  }

  const pane = (
    <section
      ref={dropRef}
      className={`journal-pane${dropping ? ' is-dropping' : ''}${entry?.mood ? ' has-mood' : ''}`}
      style={entry?.mood ? ({ '--jmood': moodVar(entry.mood) } as CSSProperties) : undefined}
      aria-label={formatDate(date, { year: true })}
    >
      <div className="journal-wash" aria-hidden />
      <DropOverlay active={dropping} />
      {mobile && <MobileNav date={date} today={today} onGo={go} />}
      <div className="journal-paper">
        {future ? (
          <Empty icon={<CalendarClock size={28} />} title={tr('这天还没到')} hint={tr('将来的日子还不能写。')} />
        ) : (
          <Entry key={date} date={date} today={today} entry={entry} mobile={mobile} onGo={go} />
        )}
      </div>
    </section>
  );

  if (mobile) return <div className="page journal-page is-mobile is-entry">{pane}</div>;
  return (
    <div className="page journal-page">
      <div className="journal-layout">
        <aside className="journal-side" aria-label={tr('月历')}>
          <div className="journal-side-head">
            <h1 className="page-title">{tr('日记')}</h1>
            <span className="grow" />
            <Button variant="secondary" isDisabled={date === today} onPress={() => go(today)}>
              {tr('今天')}
            </Button>
            <RacButton className="icon-btn" aria-label={tr('搜索')} onPress={() => ui.setPaletteOpen(true)}>
              <Search size={17} />
            </RacButton>
          </div>
          {side}
        </aside>
        {pane}
      </div>
    </div>
  );
}

/** 手机写作页顶部：回月历 · 「‹ 10月25日 周日 ›」。 */
function MobileNav({ date, today, onGo }: { date: string; today: string; onGo: (d: string) => void }) {
  return (
    <div className="journal-mnav">
      <RacButton className="journal-round" aria-label={tr('回到月历')} onPress={() => navigate({ page: 'journal' })}>
        <LayoutGrid size={17} />
      </RacButton>
      <RacButton className="icon-btn" aria-label={tr('前一天')} onPress={() => onGo(addDays(date, -1))}>
        <ChevronLeft size={18} />
      </RacButton>
      <span className="journal-mnav-title">{date === today ? tr('今天') : formatDate(date)}</span>
      <RacButton className="icon-btn" aria-label={tr('后一天')} isDisabled={date >= today} onPress={() => onGo(addDays(date, 1))}>
        <ChevronRight size={18} />
      </RacButton>
      <span className="journal-round is-spacer" aria-hidden />
    </div>
  );
}

/** 「周日 · 2026年10月 · 今天」。 */
function dayLine(date: string, today: string) {
  const { y, m, d } = parseDateKey(date);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const rel = relativeDayZh(date, today);
  return { weekday: weekdayLabel(dow, 'short'), month: monthTitle(date.slice(0, 7)), rel: rel !== formatDate(date) ? rel : '' };
}

/** 那天的日记：页头（日期 + 心情大脸）或「今天感觉怎么样？」+ 心情轮，下面是编辑器。打字先记在本地，停手、离开编辑器、换一天时存。 */
function Entry({ date, today, entry, mobile, onGo }: { date: string; today: string; entry: JournalEntry | undefined; mobile: boolean; onGo: (d: string) => void }) {
  const store = useStore();
  const [body, setBody] = useState(entry?.body_md ?? '');
  const [confirm, setConfirm] = useState(false);
  const [wheel, setWheel] = useState(false);
  const [played, setPlayed] = useState(0);
  const latest = useRef(body);
  latest.current = body;
  /** 最近一次存下去（或从库里读到）的正文。 */
  const saved = useRef(entry?.body_md ?? '');
  const editing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const editorRef = useRef<HTMLDivElement>(null);
  const faceRef = useRef<HTMLButtonElement>(null);
  const nAttach = entry ? store.attachmentsOf('journal', entry.id).length : 0;
  // 这天还什么都没有：先问心情。开始写或选了心情就换成正常页头，这次打开不再换回来（免得删光字时页面跳）
  const [asking, setAsking] = useState(!hasJournalContent(entry) && nAttach === 0);
  useEffect(() => {
    if (asking && (body.trim() || entry?.mood || nAttach > 0)) setAsking(false);
  }, [asking, body, entry?.mood, nAttach]);

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

  const setMood = (mood: string | null) => {
    clearTimeout(timer.current);
    saved.current = latest.current;
    store.setJournal(date, { mood, body_md: latest.current });
    if (mood) setPlayed((n) => n + 1);
  };
  const focusEditor = () => (editorRef.current?.querySelector('[contenteditable="true"]') as HTMLElement | null)?.focus();
  const closeWheel = () => {
    setWheel(false);
    requestAnimationFrame(() => faceRef.current?.focus());
  };

  const words = journalWordCount(body);
  const line = dayLine(date, today);
  const mood = entry?.mood ?? null;
  const isToday = date === today;

  const head = asking ? (
    <div key="ask" className="journal-ask">
      {(!mobile || isToday) && <p className="journal-ask-date">{mobile ? formatDate(date) : [formatDate(date), line.rel].filter(Boolean).join(' · ')}</p>}
      <h2 className="journal-ask-q">{isToday ? tr('今天感觉怎么样？') : tr('那天感觉怎么样？')}</h2>
      <MoodWheel value={mood} onChange={setMood} compact={mobile} />
    </div>
  ) : (
    <div key="day" className="journal-day">
      <header className="journal-dayhead">
        <div className="journal-dayhead-date">
          <div className="journal-bigday">{parseDateKey(date).d}</div>
          <div className="journal-dayline">
            <b>{line.weekday}</b>
            <span>{line.month}</span>
            {line.rel && <span>{line.rel}</span>}
            {!mobile && (
              <span className="journal-daystep">
                <RacButton className="icon-btn" aria-label={tr('前一天')} onPress={() => onGo(addDays(date, -1))}>
                  <ChevronLeft size={16} />
                </RacButton>
                <RacButton className="icon-btn" aria-label={tr('后一天')} isDisabled={date >= today} onPress={() => onGo(addDays(date, 1))}>
                  <ChevronRight size={16} />
                </RacButton>
              </span>
            )}
          </div>
        </div>
        <button
          ref={faceRef}
          type="button"
          className={`journal-face${mood ? '' : ' is-empty'}`}
          aria-expanded={wheel}
          aria-label={mood ? tr('换心情（现在是「{label}」）', { label: moodLabel(mood) || mood }) : tr('选个心情')}
          onClick={() => setWheel((w) => !w)}
        >
          <span className="journal-face-ring">{mood ? <MoodIcon key={played} mood={mood} size={76} playing={played > 0} /> : <Smile size={34} strokeWidth={1.4} />}</span>
          <b style={mood ? { color: moodVar(mood) } : undefined}>{mood ? moodLabel(mood) || mood : tr('选个心情')}</b>
          <small>{tr('点脸换心情')}</small>
        </button>
      </header>
      {wheel && (
        <div className="journal-wheel">
          <MoodWheel
            value={mood}
            hint={tr('点一下选中，再点一下取消')}
            compact={mobile}
            autoFocus
            onClose={closeWheel}
            onChange={(m) => {
              setMood(m);
              closeWheel();
            }}
          />
        </div>
      )}
    </div>
  );

  return (
    <div className={`journal-entry${asking ? ' is-asking' : ''}`}>
      {head}
      <div key="editor" ref={editorRef} className="journal-editor">
        <LazyMdEditor
          className="journal-md"
          label={tr('日记内容')}
          placeholder={isToday ? tr('写几句今天的事') : tr('这天还没写')}
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
      {asking && !mobile && <p key="hint" className="journal-ask-hint">{tr('心情可以不选，也可以先写再选')}</p>}
      <Attachments key="att" owner={{ type: 'journal', id: journalEntryId(date), date }} />
      {!asking && (
        <div key="foot" className="journal-foot">
          <span className="muted small">{words > 0 ? tr('{n} 字', { n: words }) : tr('还没写')}</span>
          {entry && (hasJournalContent(entry) || nAttach > 0) && (
            <RacButton className="icon-btn" aria-label={tr('删除这天的日记')} onPress={() => setConfirm(true)}>
              <Trash2 size={16} />
            </RacButton>
          )}
        </div>
      )}
      {asking && mobile && (
        <div key="cta" className="journal-cta-wrap">
          <RacButton className="journal-cta" onPress={focusEditor}>
            <PenLine size={18} />
            <span>{tr('先不选，直接写')}</span>
          </RacButton>
        </div>
      )}
      <ConfirmDialog
        isOpen={confirm}
        onOpenChange={setConfirm}
        title={tr('删除这天的日记？')}
        message={
          nAttach
            ? tr('「{date}」的日记和它的 {n} 个附件会被删除，不能恢复。', { date: formatDate(date, { year: true }), n: nAttach })
            : tr('「{date}」的日记会被删除，不能恢复。', { date: formatDate(date, { year: true }) })
        }
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
