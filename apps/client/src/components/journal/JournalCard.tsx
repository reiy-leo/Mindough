/**
 * 我的一天底部「今天的日记」小卡（2026-10-28 Feed 流）：今天写了几条 + 最新一条的预览和心情；
 * 点卡片看今天的条目，点「写一条」打开日记页、输入框拿焦点。「今天」按「一天从几点开始」算。
 */
import { Button as RacButton } from 'react-aria-components';
import { ChevronRight, NotebookPen, PenLine } from 'lucide-react';
import { journalPreview, moodLabel } from '@mindough/core';
import { href, navigate } from '../../lib/router';
import { requestJournalCompose } from '../../lib/journal-compose';
import { useNow, useStore } from '../../store/StoreProvider';
import { MoodIcon } from './MoodIcon';
import { tr } from '../../lib/i18n';

export function JournalCard() {
  const store = useStore();
  const now = useNow();
  const day = store.journalToday(now);
  const posts = store.journalPosts().filter((p) => p.day === day);
  const latest = posts[0];
  const preview = latest ? journalPreview(latest.body_md) || (latest.mood ? tr('心情：{label}', { label: moodLabel(latest.mood) }) : '') : '';
  return (
    <div className="card journal-card">
      <a className="journal-card-link" href={href({ page: 'journal', date: day })}>
        <span className="journal-card-icon">{latest?.mood ? <MoodIcon mood={latest.mood} size={28} /> : <NotebookPen size={20} />}</span>
        <span className="journal-card-text">
          <span className="journal-card-title">
            {tr('今天的日记')}
            {posts.length > 0 && <span className="journal-card-count">{tr('{n} 条', { n: posts.length })}</span>}
          </span>
          <span className={`journal-card-preview${preview ? '' : ' muted'}`}>{preview || tr('写几句今天的事')}</span>
        </span>
        <ChevronRight size={16} className="muted" aria-hidden />
      </a>
      <RacButton
        className="journal-card-write"
        aria-label={tr('写一条日记')}
        onPress={() => {
          requestJournalCompose();
          navigate({ page: 'journal' });
        }}
      >
        <PenLine size={16} />
        <span>{tr('写一条')}</span>
      </RacButton>
    </div>
  );
}
