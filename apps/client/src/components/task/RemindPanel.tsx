/**
 * 提醒时间（task.remind_time，「HH:MM」本机时间）：新建面板的「提醒」胶囊与详情的「提醒」一行共用。
 * 上面一排常用时间，下面系统自己的时间输入（各平台原生的样子），底部「不提醒」；一句话说明什么时候会响。
 */
import { useState } from 'react';
import { Button as RacButton } from 'react-aria-components';
import { BellOff } from 'lucide-react';
import { getLocale, intlLocale, normalizeRemindTime, type Task } from '@mindough/core';
import { remindersEnabled } from '../../lib/reminders';
import { navigate } from '../../lib/router';
import { tr } from '../../lib/i18n';

const QUICK = ['09:00', '12:00', '18:00', '21:00'];

/** 什么时候会响（说给人听）。 */
export function remindHint(t: Pick<Task, 'recurrence' | 'completion_mode' | 'target_value'>): string {
  if (t.recurrence) return tr('每个要打卡的日子，这个时间提醒你；那天已经打过卡就不提醒。');
  if (t.completion_mode === 'countdown') return tr('目标日那天，这个时间提醒你。');
  return tr('那天这个时间提醒你。');
}

/** 显示的值：「09:00」，英文 9:00 AM。 */
export function formatRemindTime(hhmm: string | null): string {
  const v = normalizeRemindTime(hhmm);
  if (!v) return tr('不提醒');
  const [h, m] = v.split(':').map(Number) as [number, number];
  return new Intl.DateTimeFormat(intlLocale(getLocale()), { hour: getLocale() === 'zh' ? '2-digit' : 'numeric', minute: '2-digit' }).format(new Date(2000, 0, 1, h, m));
}

export function RemindPanel({ value, onChange, task }: { value: string | null; onChange: (v: string | null) => void; task: Pick<Task, 'recurrence' | 'completion_mode' | 'target_value'> }) {
  const [text, setText] = useState(normalizeRemindTime(value) ?? '');
  const off = !remindersEnabled();
  return (
    <div className="pop-section remind-panel">
      <div className="date-quick remind-quick" role="group" aria-label={tr('常用时间')}>
        {QUICK.map((q) => (
          <RacButton key={q} className={`date-quick-item${value === q ? ' is-selected' : ''}`} onPress={() => onChange(q)}>
            {formatRemindTime(q)}
          </RacButton>
        ))}
      </div>
      <label className="remind-custom">
        <span className="remind-custom-label">{tr('其他时间')}</span>
        <input
          type="time"
          className="input remind-time-input"
          value={text}
          aria-label={tr('提醒时间')}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            const v = normalizeRemindTime(text);
            if (v && v !== value) onChange(v);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              const v = normalizeRemindTime(text);
              if (v) onChange(v);
            }
          }}
        />
      </label>
      <p className="pop-note">{remindHint(task)}</p>
      {off && (
        <p className="pop-note remind-off">
          {tr('提醒通知关着。')}{' '}
          <RacButton className="link-btn" onPress={() => navigate({ page: 'settings' })}>
            {tr('去设置里打开')}
          </RacButton>
        </p>
      )}
      {value && (
        <RacButton className="date-clear" onPress={() => onChange(null)}>
          <BellOff size={14} aria-hidden /> {tr('不提醒')}
        </RacButton>
      )}
    </div>
  );
}
