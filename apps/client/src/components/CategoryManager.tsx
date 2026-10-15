/**
 * 管理打卡分类（从设置挪出来，Rei 2026-10-16）：打卡页筛选条末尾的「编辑」、新建面板分类选择器底部的「管理分类…」都打开它。
 * 改名（失焦保存）、隐藏 / 显示、上移 / 下移、新增。内置分类不能删，只能隐藏；id 永远不变。
 */
import { useEffect, useState } from 'react';
import { Input, TextField } from 'react-aria-components';
import { ArrowDown, ArrowUp, Eye, EyeOff, Plus } from 'lucide-react';
import type { CheckInCategory } from '@mindough/core';
import { typeIcon } from '../lib/icons';
import { Button, IconButton, Sheet } from '../ui/primitives';
import { useStore } from '../store/StoreProvider';

export function CategoryManager({ isOpen, onOpenChange }: { isOpen: boolean; onOpenChange: (open: boolean) => void }) {
  const store = useStore();
  const [draft, setDraft] = useState('');
  const cats = store.checkInCategories(true);
  const add = () => {
    const name = draft.trim();
    if (!name) return;
    store.createCheckInCategory(name);
    setDraft('');
  };
  return (
    <Sheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title="打卡分类"
      className="modal-cats"
      footer={
        <>
          <span className="foot-note">内置的分类不能删，不想看到就隐藏。</span>
          <span className="grow" />
          <Button variant="primary" onPress={() => onOpenChange(false)}>
            完成
          </Button>
        </>
      }
    >
      <ul className="cat-manage-list">
        {cats.map((c, i) => (
          <CategoryRow key={c.id} c={c} first={i === 0} last={i === cats.length - 1} />
        ))}
        <li className="cat-row cat-row-add">
          <Plus size={16} className="cat-row-icon" aria-hidden />
          <TextField aria-label="新分类的名字" value={draft} onChange={setDraft} className="cat-name">
            <Input className="input" placeholder="新分类" onKeyDown={(e) => e.key === 'Enter' && add()} />
          </TextField>
          <Button variant="secondary" onPress={add} isDisabled={!draft.trim()}>
            添加
          </Button>
        </li>
      </ul>
    </Sheet>
  );
}

function CategoryRow({ c, first, last }: { c: CheckInCategory; first: boolean; last: boolean }) {
  const store = useStore();
  const [name, setName] = useState(c.name);
  useEffect(() => setName(c.name), [c.name]);
  const Icon = typeIcon(c.icon);
  const commit = () => {
    const n = name.trim();
    if (!n) setName(c.name);
    else if (n !== c.name) store.update('checkin_category', c.id, { name: n });
  };
  return (
    <li className={`cat-row${c.hidden ? ' is-hidden' : ''}`}>
      <Icon size={16} className="cat-row-icon" style={{ color: c.color }} aria-hidden />
      <TextField aria-label={`「${c.name}」的名字`} value={name} onChange={setName} className="cat-name">
        <Input className="input" onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
      </TextField>
      <span className="cat-row-actions">
        <IconButton label={c.hidden ? `显示「${c.name}」` : `隐藏「${c.name}」`} onPress={() => store.update('checkin_category', c.id, { hidden: !c.hidden })}>
          {c.hidden ? <EyeOff size={16} /> : <Eye size={16} />}
        </IconButton>
        <IconButton label="上移" isDisabled={first} onPress={() => store.moveCheckInCategory(c.id, -1)}>
          <ArrowUp size={16} />
        </IconButton>
        <IconButton label="下移" isDisabled={last} onPress={() => store.moveCheckInCategory(c.id, 1)}>
          <ArrowDown size={16} />
        </IconButton>
      </span>
    </li>
  );
}
