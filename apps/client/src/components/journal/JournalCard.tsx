/** 我的一天底部「今天的日记」小卡（Rei 2026-10-17 入口按推荐）：没写时「写几句今天的事」，写了显示第一行和心情；点开进日记。 */
import { ChevronRight, NotebookPen } from 'lucide-react';
import { journalPreview, moodLabel } from '@mindough/core';
import { href } from '../../lib/router';
import { useNow, useStore } from '../../store/StoreProvider';
import { MoodIcon } from './MoodIcon';
import { tr } from '../../lib/i18n';

export function JournalCard() {
  const store = useStore();
  const now = useNow();
  const day = store.journalToday(now);
  const e = store.journalOf(day);
  const preview = e ? journalPreview(e.body_md) : '';
  return (
    <a className="card journal-card" href={href({ page: 'journal' })}>
      <span className="journal-card-icon">{e?.mood ? <MoodIcon mood={e.mood} size={28} /> : <NotebookPen size={20} />}</span>
      <span className="journal-card-text">
        <span className="journal-card-title">{tr('今天的日记')}</span>
        <span className={`journal-card-preview${preview ? '' : ' muted'}`}>{preview || (e?.mood ? tr('心情：{label}', { label: moodLabel(e.mood) }) : tr('写几句今天的事'))}</span>
      </span>
      <ChevronRight size={16} className="muted" aria-hidden />
    </a>
  );
}
