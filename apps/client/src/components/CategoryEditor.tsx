/**
 * 类型编辑（Rei 2026-10-26：打卡分类、项目分类合成一套「类型」，「可以添加、不显示、修改、不能删除」）。
 * 设置 → 任务 → 类型（CategoryManager 弹层）和侧栏「管理 → 类型」页（pages/Categories.tsx）共用这一个组件。
 * 每行：图标（点开换）、名字（失焦保存，撞名不改）、颜色、不显示 / 显示、上移 / 下移；页里还能点进去看挂了它的任务和项目。
 * 没有删除按钮：类型不能删，不想看到就设成不显示（已经挂着的任务照常显示）。
 */
import { useEffect, useState, type CSSProperties } from 'react';
import { Button as RacButton, Input, TextField } from 'react-aria-components';
import { ArrowDown, ArrowUp, ChevronRight, Eye, EyeOff, Plus } from 'lucide-react';
import { categoryIcon, type Category, type Store } from '@mindough/core';
import { typeIcon } from '../lib/icons';
import { Button, IconButton, PopoverPanel } from '../ui/primitives';
import { useStore } from '../store/StoreProvider';
import { ColorPicker, IconPicker } from './TypeManager';
import { dataLabel, tr } from '../lib/i18n';

export interface CategoryEditorProps {
  /** 点一行右边的箭头：看挂了它的任务和项目（类型页用；设置里不给）。 */
  onOpen?: (id: string) => void;
  /** 当前打开的（类型页高亮）。 */
  selectedId?: string | null;
}

/** 每个类型挂了多少件任务 + 项目（没删的；顺着合并算到留下的那个）。 */
export function categoryUsage(store: Store): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of store.list('task')) {
    const c = store.categoryOf(t);
    if (c) m.set(c.id, (m.get(c.id) ?? 0) + 1);
  }
  for (const g of store.list('group')) {
    const c = store.category(g.category_id);
    if (c) m.set(c.id, (m.get(c.id) ?? 0) + 1);
  }
  return m;
}

export function CategoryEditor({ onOpen, selectedId }: CategoryEditorProps) {
  const store = useStore();
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState('');
  const cats = store.categories(true);
  const counts = categoryUsage(store);
  const add = () => {
    const name = draft.trim();
    if (!name) return;
    const taken = store.categoryNameTaken(name);
    const c = store.createCategory(name);
    setNote(taken ? tr('已经有「{name}」了', { name: dataLabel(c.name) }) : '');
    setDraft('');
  };
  return (
    <div className="cat-editor">
      <ul className="cat-manage-list">
        {cats.map((c, i) => (
          <CategoryEditRow key={c.id} c={c} first={i === 0} last={i === cats.length - 1} count={counts.get(c.id) ?? 0} onOpen={onOpen} selected={selectedId === c.id} onNote={setNote} />
        ))}
        <li className="cat-row cat-row-add">
          <Plus size={16} className="cat-row-icon" aria-hidden />
          <TextField aria-label={tr('新类型的名字')} value={draft} onChange={setDraft} className="cat-name">
            <Input className="input" placeholder={tr('新类型')} onKeyDown={(e) => e.key === 'Enter' && add()} />
          </TextField>
          <Button variant="secondary" onPress={add} isDisabled={!draft.trim()}>
            {tr('添加')}</Button>
        </li>
      </ul>
      <p className="foot-note cat-editor-note" role="status">
        {note || tr('类型不能删，不想看到就设成不显示；已经挂着的任务和项目照常显示。')}
      </p>
    </div>
  );
}

function CategoryEditRow({ c, first, last, count, onOpen, selected, onNote }: { c: Category; first: boolean; last: boolean; count: number; onOpen?: (id: string) => void; selected: boolean; onNote: (s: string) => void }) {
  const store = useStore();
  // 显示名：内置类型没改过名时按当前语言显示；没改动就不写回（存着的仍是中文原名）
  const shown = dataLabel(c.name);
  const [name, setName] = useState(shown);
  useEffect(() => setName(shown), [shown]);
  const Icon = typeIcon(categoryIcon(c));
  const commit = () => {
    const n = name.trim();
    if (!n || n === shown || n === c.name) return setName(shown);
    if (!store.updateCategory(c.id, { name: n })) {
      onNote(tr('已经有叫「{name}」的类型了，名字没改', { name: n }));
      setName(shown);
    } else onNote('');
  };
  return (
    <li className={`cat-row${c.hidden ? ' is-hidden' : ''}${selected ? ' is-selected' : ''}`} style={{ '--chip-color': c.color } as CSSProperties}>
      <PopoverPanel
        label={tr('图标')}
        className="icon-pick-popover"
        trigger={
          <RacButton className="cat-icon-btn" aria-label={tr('换「{name}」的图标', { name: shown })}>
            <Icon size={16} style={{ color: c.color }} aria-hidden />
          </RacButton>
        }
      >
        {(close) => (
          <IconPicker
            value={c.icon}
            onChange={(icon) => {
              store.updateCategory(c.id, { icon });
              close();
            }}
          />
        )}
      </PopoverPanel>
      <TextField aria-label={tr('「{name}」的名字', { name: shown })} value={name} onChange={setName} className="cat-name">
        <Input className="input" onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
      </TextField>
      <span className="cat-row-actions">
        <PopoverPanel
          label={tr('颜色')}
          placement="bottom end"
          className="cat-color-popover"
          trigger={
            <RacButton className="cat-color-btn" aria-label={tr('换「{name}」的颜色', { name: shown })}>
              <span className="cat-color-dot" style={{ background: c.color }} aria-hidden />
            </RacButton>
          }
        >
          <ColorPicker value={c.color} onChange={(color: string) => store.updateCategory(c.id, { color })} />
        </PopoverPanel>
        <IconButton label={c.hidden ? tr('显示「{name}」', { name: shown }) : tr('不显示「{name}」', { name: shown })} onPress={() => store.updateCategory(c.id, { hidden: !c.hidden })}>
          {c.hidden ? <EyeOff size={16} /> : <Eye size={16} />}
        </IconButton>
        <IconButton label={tr('上移')} isDisabled={first} onPress={() => store.moveCategory(c.id, -1)}>
          <ArrowUp size={16} />
        </IconButton>
        <IconButton label={tr('下移')} isDisabled={last} onPress={() => store.moveCategory(c.id, 1)}>
          <ArrowDown size={16} />
        </IconButton>
        {onOpen && (
          <RacButton className="cat-open" aria-label={tr('看挂了「{name}」的任务和项目', { name: shown })} onPress={() => onOpen(c.id)}>
            {count > 0 && <span className="cat-count">{count}</span>}
            <ChevronRight size={16} aria-hidden />
          </RacButton>
        )}
      </span>
    </li>
  );
}
