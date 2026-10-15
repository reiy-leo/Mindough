/**
 * 桌面「小窗」（Tauri 第二个窗口，?window=mini）：置顶的一小块，只放 我的一天 + 今天要打卡，可以直接勾掉 / 打卡。
 * 结构沿用 TaskRow（勾、计时、+1 都和主窗口一样）；点一行在小窗里打开详情。窗口之间的数据经 lib/windows.ts 同步。
 */
import { useState } from 'react';
import { Button as RacButton, Form, Input, TextField } from 'react-aria-components';
import { AppWindow, Pin, PinOff, Plus, Sun } from 'lucide-react';
import { dueToday, formatDateZh, myDayItems, toDateKey } from '@mindough/core';
import { useNow, useStore } from '../store/StoreProvider';
import { TaskRow } from './TaskRow';
import { Tip } from '../ui/primitives';
import { focusMainWindow, setMiniOnTop } from '../lib/windows';
import { tr } from '../lib/i18n';

export function MiniWindow() {
  const store = useStore();
  const now = useNow();
  const today = toDateKey(now);
  const [onTop, setOnTop] = useState(true);
  const [draft, setDraft] = useState('');
  const tasks = store.list('task');
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const items = myDayItems(store.list('my_day'), byId, store.list('check_in'), today, now);
  const inDay = new Set(items.map((i) => i.task.id));
  const checkins = store.tasks().filter((t) => dueToday(t, today) && !inDay.has(t.id));
  const counted = items.filter((i) => i.task.status !== '关闭');
  const done = counted.filter((i) => i.done).length;

  const add = () => {
    const text = draft.trim();
    if (!text) return;
    const t = store.createTask({ body_md: text });
    store.addToMyDay(t.id, today);
    setDraft('');
  };

  return (
    <div className="mini-window">
      <header className="mini-head" data-tauri-drag-region>
        <Sun size={18} className="mini-head-icon" aria-hidden />
        <div className="mini-head-text" data-tauri-drag-region>
          <h1 className="mini-title">{tr('我的一天')}</h1>
          <div className="mini-sub">
            {formatDateZh(today)}
            {counted.length > 0 && ` · ${tr('{doneCount}/{counted} 已完成', { doneCount: done, counted: counted.length })}`}
          </div>
        </div>
        <Tip content={onTop ? tr('不再置顶') : tr('置顶')}>
          <RacButton
            className={`icon-btn${onTop ? ' is-on' : ''}`}
            aria-label={onTop ? tr('不再置顶') : tr('置顶')}
            aria-pressed={onTop}
            onPress={() => {
              setOnTop(!onTop);
              void setMiniOnTop(!onTop);
            }}
          >
            {onTop ? <Pin size={16} /> : <PinOff size={16} />}
          </RacButton>
        </Tip>
        <Tip content={tr('打开主窗口')}>
          <RacButton className="icon-btn" aria-label={tr('打开主窗口')} onPress={() => void focusMainWindow()}>
            <AppWindow size={16} />
          </RacButton>
        </Tip>
      </header>
      <div className="mini-body">
        {items.length === 0 ? (
          <p className="mini-empty">{tr('今天还没有安排。')}</p>
        ) : (
          <div className="task-list plain mini-list">
            {items.map((i) => (
              <TaskRow key={i.task.id} store={store} task={i.task} showMyDay={false} showGroup={false} doneOverride={i.done} />
            ))}
          </div>
        )}
        {checkins.length > 0 && (
          <>
            <h2 className="mini-section-title">{tr('今天要打卡')}</h2>
            <div className="task-list plain mini-list">
              {checkins.map((t) => (
                <TaskRow key={t.id} store={store} task={t} showMyDay={false} showGroup={false} />
              ))}
            </div>
          </>
        )}
      </div>
      <Form
        className="mini-add"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <Plus size={16} aria-hidden className="muted" />
        <TextField aria-label={tr('添加任务到今天')} value={draft} onChange={setDraft} className="grow">
          <Input className="mini-add-input" placeholder={tr('加到今天…')} />
        </TextField>
      </Form>
    </div>
  );
}
