import { useLayoutEffect, useRef, useState } from 'react';
import { Form, Input, TextField, Button as RacButton } from 'react-aria-components';
import { CalendarDays, ChevronsUp, Plus } from 'lucide-react';
import { weekdayLabel, addDays, compareDateKey, diffDays, formatDateZh, relativeDayZh, toDateKey, weekday } from '@mindough/core';
import { useNow, useStore } from '../store/StoreProvider';
import { Button } from '../ui/primitives';
import { TaskRow } from '../components/TaskRow';
import { LunarLine } from '../components/LunarLine';
import { PageHeader } from '../components/PageHeader';

import { tr, trc } from '../lib/i18n';
/** Agenda 式时间线：按日期往下流，今天居中；过去在上、将来在下。 */
export function AgendaPage() {
  const store = useStore();
  const now = useNow();
  const today = toDateKey(now);
  const [pastDays, setPastDays] = useState(14);
  const [adding, setAdding] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const todayRef = useRef<HTMLLIElement>(null);

  const dated = store.tasks().filter((t) => t.scheduled_date && !t.recurrence);
  const from = addDays(today, -pastDays);
  const byDate = new Map<string, typeof dated>();
  for (const t of dated) {
    if (t.scheduled_date! < from) continue;
    byDate.set(t.scheduled_date!, [...(byDate.get(t.scheduled_date!) ?? []), t]);
  }
  // 今天和明天总是显示，方便随手记
  for (const d of [today, addDays(today, 1)]) if (!byDate.has(d)) byDate.set(d, []);
  const dates = [...byDate.keys()].sort(compareDateKey);
  const hiddenPast = dated.filter((t) => t.scheduled_date! < from).length;

  useLayoutEffect(() => {
    todayRef.current?.scrollIntoView({ block: 'center' });
  }, []);

  const submit = (date: string) => {
    if (draft.trim()) store.createTask({ body_md: draft.trim(), scheduled_date: date });
    setDraft('');
    setAdding(null);
  };

  return (
    <div className="page">
      <PageHeader title={trc('导航', '列表')} subtitle={tr('随手记下的琐事，按日期排开')} icon={<CalendarDays size={22} />} />
      {hiddenPast > 0 && (
        <Button variant="ghost" className="load-past" onPress={() => setPastDays((d) => d + 30)}>
          <ChevronsUp size={16} />
          {tr('更早的 {hiddenPast} 条', { hiddenPast })}</Button>
      )}
      <ol className="agenda">
        {dates.map((d) => {
          const list = byDate.get(d)!;
          const rel = compareDateKey(d, today);
          return (
            <li key={d} className={`agenda-day${rel === 0 ? ' is-today' : rel < 0 ? ' is-past' : ''}`} ref={rel === 0 ? todayRef : undefined}>
              <div className="agenda-date">
                {Math.abs(diffDays(today, d)) <= 2 ? (
                  <>
                    <span className="agenda-rel">{relativeDayZh(d, today)}</span>
                    <span className="agenda-full">{formatDateZh(d)}</span>
                  </>
                ) : (
                  <>
                    <span className="agenda-rel">{formatDateZh(d, false)}</span>
                    <span className="agenda-full">{weekdayLabel(weekday(d), 'short')}</span>
                  </>
                )}
                <LunarLine date={d} />
              </div>
              <div className="agenda-items">
                {list.map((t) => (
                  <TaskRow key={t.id} store={store} task={t} />
                ))}
                {adding === d ? (
                  <Form
                    className="add-bar inline"
                    onSubmit={(e) => {
                      e.preventDefault();
                      submit(d);
                    }}
                  >
                    <TextField aria-label={tr('添加到{formatDateZh}', { formatDateZh: formatDateZh(d) })} value={draft} onChange={setDraft} className="add-bar-field" autoFocus onBlur={() => submit(d)}>
                      <Input className="add-bar-input" placeholder={tr('写下一件事，按回车添加')} />
                    </TextField>
                  </Form>
                ) : (
                  <RacButton className="agenda-add" onPress={() => setAdding(d)}>
                    <Plus size={14} /> {tr('添加')}</RacButton>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
