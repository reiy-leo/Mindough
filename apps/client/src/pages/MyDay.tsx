import { GridList, GridListItem, useDragAndDrop, Button as RacButton } from 'react-aria-components';
import { GripVertical, Lightbulb, PictureInPicture2, RotateCcw, Sun } from 'lucide-react';
import { formatDateZh, myDayItems, recentlyUnlocked, suggestions, toDateKey, yesterdayUnfinished } from '@mindough/core';
import { useNow, useStore } from '../store/StoreProvider';
import { useUi } from '../lib/ui';
import { Button, Empty, Section, Tip } from '../ui/primitives';
import { openMiniWindow } from '../lib/windows';
import { isTauri } from '../store/sqlite-tauri';
import { useReorderGuard } from '../lib/drag-guard';
import { createToday } from '../lib/quick-add';
import { QuickAddBar } from '../components/QuickAddBar';

/** 小窗只在桌面 app 里有（手机、网页没有置顶窗口）。 */
const canMini = isTauri() && !/Android|iPhone|iPad/i.test(navigator.userAgent);
import { TaskRow } from '../components/TaskRow';
import { LunarLine } from '../components/LunarLine';
import { useSettings } from '../lib/settings';
import { JournalCard } from '../components/journal/JournalCard';

import { tr } from '../lib/i18n';

export function MyDayPage() {
  const store = useStore();
  const ui = useUi();
  const now = useNow();
  const today = toDateKey(now);
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

  // 拖完不留高亮、不选中被拖的行（lib/drag-guard）
  const reorderGuard = useReorderGuard();
  const { dragAndDropHooks } = useDragAndDrop({
    ...reorderGuard.handlers,
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

  return (
    <div className="page">
      {/* 中间列不放页头（Rei 2026-10-26「我的一天、待安排、可做的中间列的header去掉，换成输入框」）：最上面就是添加框，
          日期和完成数挪到列表上方的小字，小窗按钮挪到添加框行尾 */}
      <QuickAddBar
        placeholder={tr('今天要做什么？按回车添加')}
        label={tr('添加任务到今天')}
        create={(body) => createToday(store, body, today)}
        trailing={
          canMini ? (
            <Tip content={tr('小窗：置顶显示今天的事')}>
              <RacButton className="icon-btn add-bar-btn" aria-label={tr('打开小窗')} onPress={() => void openMiniWindow()}>
                <PictureInPicture2 size={17} />
              </RacButton>
            </Tip>
          ) : undefined
        }
      />
      <div className="list-meta">
        <h1 className="sr-only">{tr('我的一天')}</h1>
        {`${formatDateZh(today)} · ${items.length ? (closedCount ? tr('{doneCount}/{counted} 已完成 · {closed} 个已关闭', { doneCount, counted, closed: closedCount }) : tr('{doneCount}/{counted} 已完成', { doneCount, counted })) : tr('还没有安排')}`}
        <LunarLine date={today} className="page-subtitle-lunar" />
      </div>

      {items.length ? (
        <GridList ref={reorderGuard.ref} aria-label={tr('今天的任务')} className="task-list" dragAndDropHooks={dragAndDropHooks} dependencies={[ui.editingId]} items={items.map((i) => ({ ...i, id: i.task.id }))}>
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
                // 行尾不放 ×（Rei 2026-10-25「删除my day中的条目右侧的x按钮」）：移出我的一天用行的右键 / 长按菜单或详情里的太阳
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
          <div className="task-list plain carry-list">
            {yesterday.map((t) => (
              <TaskRow
                key={t.id}
                store={store}
                task={t}
                showMyDay={false}
                showCheckIn={inlineCheckIn}
                trailing={
                  <Tip content={tr('带回今天')}>
                    <Button variant="tonal" className="small carry-btn" aria-label={tr('带回今天')} onPress={() => store.addToMyDay(t.id, today)}>
                      <Sun size={14} className="carry-icon" aria-hidden />
                      <span className="carry-label">{tr('带回今天')}</span>
                    </Button>
                  </Tip>
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
