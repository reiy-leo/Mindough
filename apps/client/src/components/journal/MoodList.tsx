/**
 * 左栏热力图下面的心情列表（Rei 2026-10-28「左侧除了activity图，还可以显示一个心情列表」）。
 * 每个用过的心情一行：动画图标 + 名字 + 条数，按条数从多到少（core moodCounts）；没用过的不显示。
 * 点一行只看这个心情的条目（能和选中的某天叠加），再点一次取消。悬停、选中时脸动一下。
 */
import { useState, type CSSProperties } from 'react';
import { moodLabel, type MoodId } from '@mindough/core';
import { MoodIcon } from './MoodIcon';
import { tr } from '../../lib/i18n';

export function MoodList({ counts, selected, onSelect }: { counts: ReadonlyArray<{ id: MoodId; count: number }>; selected: string | null; onSelect: (mood: string | null) => void }) {
  const [played, setPlayed] = useState<{ id: string; n: number } | null>(null);
  const play = (id: string) => setPlayed((p) => ({ id, n: (p?.n ?? 0) + 1 }));
  if (!counts.length) return null;
  const max = Math.max(...counts.map((c) => c.count));
  return (
    <section className="jmoods" aria-label={tr('心情')}>
      <h2 className="jside-title">{tr('心情')}</h2>
      <ul className="jmoods-list">
        {counts.map(({ id, count }) => {
          const on = selected === id;
          return (
            <li key={id}>
              <button
                type="button"
                className={`jmoods-row${on ? ' is-selected' : ''}`}
                aria-pressed={on}
                aria-label={tr('{mood}：{n} 条', { mood: moodLabel(id), n: count })}
                style={{ '--jm': `var(--mood-${id})`, '--jw': `${Math.max(6, Math.round((count / max) * 100))}%` } as CSSProperties}
                onPointerEnter={() => play(id)}
                onClick={() => {
                  if (!on) play(id);
                  onSelect(on ? null : id);
                }}
              >
                <MoodIcon key={played?.id === id ? played.n : 0} mood={id} size={26} playing={played?.id === id} />
                <span className="jmoods-name">{moodLabel(id)}</span>
                <span className="jmoods-bar" aria-hidden />
                <span className="jmoods-count">{count}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
