/**
 * 挑任务的可搜索列表：详情里加前后关系 / 相关任务，新建面板里的「相关任务」都用它。
 * 给了 selected 就是多选（点一下勾上 / 取消，弹层不关），否则点一下就选中。
 */
import { Autocomplete, Input, ListBox, ListBoxItem, SearchField, useFilter } from 'react-aria-components';
import { Check, Search } from 'lucide-react';
import { isFinished, type Store, type Task } from '@mindough/core';
import { titleOf } from '../../lib/view';

/** 列表里一件任务的状态短语（可开始的待办不写，免得满屏字）。 */
export function taskStateText(store: Store, t: Task): string | null {
  if (t.status === '完成') return '已完成';
  if (t.status === '关闭') return '已关闭';
  if (t.status === '进行中') return '进行中';
  if (store.derived().get(t.id)?.state === '被阻塞') return '还不能开始';
  return null;
}

export function TaskSearch({
  store,
  exclude,
  selected,
  label = '搜索任务',
  onPick,
}: {
  store: Store;
  exclude: Set<string>;
  selected?: ReadonlySet<string>;
  label?: string;
  onPick: (id: string) => void;
}) {
  const { contains } = useFilter({ sensitivity: 'base' });
  const items = store
    .tasks()
    .filter((t) => !exclude.has(t.id))
    .map((t) => ({ id: t.id, title: titleOf(store, t), finished: isFinished(t.status), picked: !!selected?.has(t.id) }))
    .sort((a, b) => Number(b.picked) - Number(a.picked) || Number(a.finished) - Number(b.finished));
  return (
    <div className="task-search">
      <Autocomplete filter={contains}>
        <SearchField aria-label={label} className="cat-search" autoFocus>
          <Search size={14} aria-hidden className="cat-search-icon" />
          <Input className="input" placeholder={label} />
        </SearchField>
        <ListBox
          aria-label="任务"
          className="listbox pick-list task-search-list"
          items={items}
          {...(selected ? { selectionMode: 'multiple' as const, selectedKeys: [...selected].filter((id) => items.some((i) => i.id === id)) } : {})}
          onAction={selected ? undefined : (k) => onPick(String(k))}
          onSelectionChange={selected ? (keys) => {
            if (keys === 'all') return;
            const next = new Set([...keys].map(String));
            const changed = [...next].find((id) => !selected.has(id)) ?? [...selected].find((id) => !next.has(id));
            if (changed) onPick(changed);
          } : undefined}
          renderEmptyState={() => <div className="pick-empty">没有找到</div>}
        >
          {(t) => (
            <ListBoxItem id={t.id} className="listbox-item pick-item" textValue={t.title}>
              <span className={`grow ellipsis${t.finished ? ' muted' : ''}`}>{t.title}</span>
              {t.finished && <span className="pick-meta">已结束</span>}
              {selected && <Check size={14} className="pick-check" />}
            </ListBoxItem>
          )}
        </ListBox>
      </Autocomplete>
    </div>
  );
}
