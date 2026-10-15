import { useState } from 'react';
import { GridList, GridListItem, useDragAndDrop, Button as RacButton, Form, Input, TextField } from 'react-aria-components';
import { GripVertical, Lightbulb, Plus, RotateCcw, Search, Sun, X } from 'lucide-react';
import { formatDateZh, myDayItems, recentlyUnlocked, suggestions, toDateKey, yesterdayUnfinished } from '@mindough/core';
import { useNow, useStore } from '../store/StoreProvider';
import { useUi } from '../lib/ui';
import { Button, Chip, Empty, Section } from '../ui/primitives';
import { TaskRow } from '../components/TaskRow';
import { PageHeader } from '../components/PageHeader';

const REASON_COLOR: Record<string, string> = {
  今天到期: 'var(--warning)',
  今天要打卡: 'var(--accent)',
  刚解锁: 'var(--state-done)',
  倒数日到了: 'var(--danger)',
};

export function MyDayPage() {
  const store = useStore();
  const ui = useUi();
  const now = useNow();
  const today = toDateKey(now);
  const [draft, setDraft] = useState('');
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
  const doneCount = items.filter((i) => i.done).length;

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
        title="我的一天"
        subtitle={`${formatDateZh(today)} · ${items.length ? `${doneCount}/${items.length} 已完成` : '还没有安排'}`}
        icon={<Sun size={22} />}
      />

      <Form
        className="add-bar"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <Plus size={18} className="add-bar-icon" aria-hidden />
        <TextField aria-label="添加任务到今天" value={draft} onChange={setDraft} className="add-bar-field">
          <Input className="add-bar-input" placeholder="添加任务到今天，回车保存" />
        </TextField>
        <RacButton className="btn btn-secondary add-bar-search" onPress={() => ui.setPaletteOpen(true)}>
          <Search size={15} />
          <span className="hide-mobile">从全部任务添加</span>
          <kbd className="kbd hide-mobile">⌘K</kbd>
        </RacButton>
      </Form>

      {items.length ? (
        <GridList aria-label="今天的任务" className="task-list" dragAndDropHooks={dragAndDropHooks} items={items.map((i) => ({ ...i, id: i.task.id }))}>
          {(item) => (
            <GridListItem id={item.id} textValue={item.task.body_md.slice(0, 40) || '任务'} className="list-item">
              <RacButton slot="drag" className="drag-handle" aria-label="拖动排序">
                <GripVertical size={14} />
              </RacButton>
              <TaskRow
                store={store}
                task={item.task}
                showMyDay={false}
                doneOverride={item.done}
                trailing={
                  <RacButton className="icon-btn" aria-label="移出我的一天" onPress={() => store.removeFromMyDay(item.task.id, today)}>
                    <X size={16} />
                  </RacButton>
                }
              />
            </GridListItem>
          )}
        </GridList>
      ) : (
        <Empty icon={<Sun size={28} />} title="今天还是空的" hint="在上面直接写，或按 ⌘K / Ctrl+K 从全部任务里挑几件加进来" />
      )}

      {yesterday.length > 0 && (
        <Section
          title={
            <>
              <RotateCcw size={15} /> 昨天没做完 <span className="count">{yesterday.length}</span>
            </>
          }
          extra={
            <Button variant="ghost" onPress={() => yesterday.forEach((t) => store.addToMyDay(t.id, today))}>
              全部带回今天
            </Button>
          }
        >
          <div className="task-list plain">
            {yesterday.map((t) => (
              <TaskRow
                key={t.id}
                store={store}
                task={t}
                showMyDay={false}
                trailing={
                  <Button variant="tonal" className="small" onPress={() => store.addToMyDay(t.id, today)}>
                    带回今天
                  </Button>
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
              <Lightbulb size={15} /> 建议 <span className="count">{sugg.length}</span>
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
                trailing={
                  <>
                    <Chip color={REASON_COLOR[s.reason]} className="hide-mobile">
                      {s.reason}
                    </Chip>
                    <Button variant="tonal" className="small" onPress={() => store.addToMyDay(s.task.id, today)} aria-label="加入我的一天">
                      <Plus size={14} />
                      <span className="hide-mobile">加入</span>
                    </Button>
                  </>
                }
              />
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
