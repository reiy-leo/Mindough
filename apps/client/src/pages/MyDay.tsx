import { useState } from 'react';
import { GridList, GridListItem, useDragAndDrop, Button as RacButton, Form, Input, TextField } from 'react-aria-components';
import { GripVertical, Lightbulb, PictureInPicture2, Plus, RotateCcw, Search, Sun, X } from 'lucide-react';
import { formatDateZh, myDayItems, recentlyUnlocked, suggestions, toDateKey, yesterdayUnfinished } from '@mindough/core';
import { useNow, useStore } from '../store/StoreProvider';
import { useUi } from '../lib/ui';
import { Button, Empty, Section, Tip } from '../ui/primitives';
import { openMiniWindow } from '../lib/windows';
import { isTauri } from '../store/sqlite-tauri';

/** 小窗只在桌面 app 里有（手机、网页没有置顶窗口）。 */
const canMini = isTauri() && !/Android|iPhone|iPad/i.test(navigator.userAgent);
import { TaskRow } from '../components/TaskRow';
import { LunarLine } from '../components/LunarLine';
import { PageHeader } from '../components/PageHeader';
import { useSettings } from '../lib/settings';
import { JournalCard } from '../components/journal/JournalCard';

import { tr } from '../lib/i18n';

export function MyDayPage() {
  const store = useStore();
  const ui = useUi();
  const now = useNow();
  const today = toDateKey(now);
  const [draft, setDraft] = useState('');
  const { layout } = useSettings();
  const inlineCheckIn = layout !== 'mobile';
  const tasks = store.list('task');
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const entries = store.list('my_day');
  const checkIns = store.list('check_in');
  const items = myDayItems(entries, byId, checkIns, today, now);
  const yesterday = yesterdayUnfinished(entries, byId, checkIns, today, now);
  const derived = store.derived();
  const unlocked = recentlyUnlocked(tasks, store.edges(), derived, new Date(now.getTime() - 24 * 3600_000).toISOString());
  const yIds = new Set(yesterday.map((t) => t.id));
  const sugg = suggestions({ tasks, entries, checkIns, derived, recentlyUnlocked: unlocked, today, now }).filter((s) => !yIds.has(s.task.id));
  // 关闭的算结束（沉底）但不算成就：不计入“已完成 x/y”
  const closedCount = items.filter((i) => i.task.status === '关闭').length;
  const counted = items.length - closedCount;
  const doneCount = items.filter((i) => i.done && i.task.status !== '关闭').length;

  const { dragAndDropHooks } = useDragAndDrop({
    getItems: (keys) => [...keys].map((k) => ({ 'text/plain': String(k) })),
    onReorder: (e) => {
      const order = items.map((i) => i.task.id);
      const moving = [...e.keys].map(String);
      const rest = order.filter((id) => !moving.includes(id));
      const targetIdx = rest.indexOf(String(e.target.key));
      const insertAt = e.target.dropPosition === 'before' ? targetIdx : targetIdx + 1;
      rest.splice(insertAt, 0, ...moving);
      store.reorderMyDay(today, rest);
    },
  });

  const add = () => {
    const text = draft.trim();
    if (!text) return;
    const t = store.createTask({ body_md: text });
    store.addToMyDay(t.id, today);
    setDraft('');
  };

  return (
    <div className="page">
      <PageHeader
        title={tr('我的一天')}
        subtitle={
          <>
            {`${formatDateZh(today)} · ${items.length ? (closedCount ? tr('{doneCount}/{counted} 已完成 · {closed} 个已关闭', { doneCount, counted, closed: closedCount }) : tr('{doneCount}/{counted} 已完成', { doneCount, counted })) : tr('还没有安排')}`}
            <LunarLine date={today} className="page-subtitle-lunar" />
          </>
        }
        icon={<Sun size={22} />}
        {...(canMini
          ? {
              actions: (
                <Tip content={tr('小窗：置顶显示今天的事')}>
                  <RacButton className="icon-btn" aria-label={tr('打开小窗')} onPress={() => void openMiniWindow()}>
                    <PictureInPicture2 size={18} />
                  </RacButton>
                </Tip>
              ),
            }
          : {})}
      />

      <Form
        className="add-bar"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <Plus size={18} className="add-bar-icon" aria-hidden />
        <TextField aria-label={tr('添加任务到今天')} value={draft} onChange={setDraft} className="add-bar-field">
          <Input className="add-bar-input" placeholder={tr('今天要做什么？按回车添加')} />
        </TextField>
        <RacButton className="btn btn-secondary add-bar-search" onPress={() => ui.setPaletteOpen(true)}>
          <Search size={15} />
          <span className="hide-mobile">{tr('从全部任务添加')}</span>
          <kbd className="kbd hide-mobile">⌘K</kbd>
        </RacButton>
      </Form>

      {items.length ? (
        <GridList aria-label={tr('今天的任务')} className="task-list" dragAndDropHooks={dragAndDropHooks} dependencies={[ui.editingId]} items={items.map((i) => ({ ...i, id: i.task.id }))}>
          {(item) => (
            <GridListItem id={item.id} textValue={item.task.body_md.slice(0, 40) || tr('任务')} className={`list-item${ui.editingId === item.id ? ' is-selected' : ''}`}>
              <RacButton slot="drag" className="drag-handle" aria-label={tr('拖动排序')}>
                <GripVertical size={14} />
              </RacButton>
              <TaskRow
                store={store}
                task={item.task}
                showMyDay={false}
                doneOverride={item.done}
                trailing={
                  <RacButton className="icon-btn" aria-label={tr('移出我的一天')} onPress={() => store.removeFromMyDay(item.task.id, today)}>
                    <X size={16} />
                  </RacButton>
                }
              />
            </GridListItem>
          )}
        </GridList>
      ) : (
        <Empty icon={<Sun size={28} />} title={tr('今天还是空的')} hint={tr('在上面直接写，或按 ⌘K / Ctrl+K 从全部任务里挑几件加进来')} />
      )}

      {yesterday.length > 0 && (
        <Section
          title={
            <>
              <RotateCcw size={15} /> {tr('昨天没做完')} <span className="count">{yesterday.length}</span>
            </>
          }
          extra={
            <Button variant="ghost" onPress={() => yesterday.forEach((t) => store.addToMyDay(t.id, today))}>
              {tr('全部带回今天')}</Button>
          }
        >
          <div className="task-list plain">
            {yesterday.map((t) => (
              <TaskRow
                key={t.id}
                store={store}
                task={t}
                showMyDay={false}
                showCheckIn={inlineCheckIn}
                trailing={
                  <Button variant="tonal" className="small" onPress={() => store.addToMyDay(t.id, today)}>
                    {tr('带回今天')}</Button>
                }
              />
            ))}
          </div>
        </Section>
      )}

      {sugg.length > 0 && (
        <Section
          title={
            <>
              <Lightbulb size={15} /> {tr('建议')} <span className="count">{sugg.length}</span>
            </>
          }
        >
          <div className="task-list plain">
            {sugg.map((s) => (
              <TaskRow
                key={s.task.id}
                store={store}
                task={s.task}
                showMyDay={false}
                showDate
                showCheckIn={inlineCheckIn}
                // 行尾不放「今天到期」徽章和「+ 加入」（Rei 2026-10-25「任何情况下都不显示这两个按钮」）：
                // 到期看元信息里的日期，加入我的一天用行的右键 / 长按菜单（TaskRow）
              />
            ))}
          </div>
        </Section>
      )}

      <JournalCard />
    </div>
  );
}
