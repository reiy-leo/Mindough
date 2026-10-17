/** 心情：12 个图标按钮，点选播动画，再点一次取消（Rei 2026-10-17：只要心情，可以不填）。 */
import { useState } from 'react';
import { Button as RacButton } from 'react-aria-components';
import { moodLabel, moods } from '@mindough/core';
import { Tip } from '../../ui/primitives';
import { MoodIcon } from './MoodIcon';
import { tr } from '../../lib/i18n';

export function MoodPicker({ value, onChange, isDisabled }: { value: string | null; onChange: (mood: string | null) => void; isDisabled?: boolean }) {
  // 每次点选换一个 n，图标重新挂上、动画重新播
  const [play, setPlay] = useState<{ id: string; n: number } | null>(null);
  return (
    <div className="mood-picker">
      <div className="mood-picker-head">
        <span className="mood-picker-label">{tr('心情')}</span>
        <span className="mood-picker-value" aria-live="polite">
          {value ? moodLabel(value) || value : <span className="muted">{tr('不填也行')}</span>}
        </span>
      </div>
      <div className="mood-grid" role="group" aria-label={tr('心情')}>
        {moods().map((m) => {
          const on = value === m.id;
          return (
            <Tip key={m.id} content={m.label} delay={300}>
              <RacButton
                className={`mood-btn${on ? ' is-selected' : ''}`}
                aria-pressed={on}
                aria-label={on ? tr('心情：{label}（再点一次取消）', { label: m.label }) : tr('心情：{label}', { label: m.label })}
                isDisabled={isDisabled}
                onPress={() => {
                  onChange(on ? null : m.id);
                  if (!on) setPlay((p) => ({ id: m.id, n: (p?.n ?? 0) + 1 }));
                }}
              >
                <MoodIcon key={play?.id === m.id ? play.n : 0} mood={m.id} size={30} playing={play?.id === m.id} />
                <span className="mood-btn-label">{m.label}</span>
              </RacButton>
            </Tip>
          );
        })}
      </div>
    </div>
  );
}
