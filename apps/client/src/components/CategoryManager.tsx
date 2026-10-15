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

import { dataLabel, tr } from '../lib/i18n';
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
      title={tr('打卡分类')}
      className="modal-cats"
      footer={
        <>
          <span className="foot-note">{tr('内置的分类不能删，不想看到就隐藏。')}</span>
          <span className="grow" />
          <Button variant="primary" onPress={() => onOpenChange(false)}>
            {tr('完成')}</Button>
        </>
      }
    >
      <ul className="cat-manage-list">
        {cats.map((c, i) => (
          <CategoryRow key={c.id} c={c} first={i === 0} last={i === cats.length - 1} />
        ))}
        <li className="cat-row cat-row-add">
          <Plus size={16} className="cat-row-icon" aria-hidden />
          <TextField aria-label={tr('新分类的名字')} value={draft} onChange={setDraft} className="cat-name">
            <Input className="input" placeholder={tr('新分类')} onKeyDown={(e) => e.key === 'Enter' && add()} />
          </TextField>
          <Button variant="secondary" onPress={add} isDisabled={!draft.trim()}>
            {tr('添加')}</Button>
        </li>
      </ul>
    </Sheet>
  );
}

function CategoryRow({ c, first, last }: { c: CheckInCategory; first: boolean; last: boolean }) {
  const store = useStore();
  // 显示名：内置分类没改过名时按当前语言显示；没改动就不写回（存着的仍是中文原名）
  const shown = dataLabel(c.name);
  const [name, setName] = useState(shown);
  useEffect(() => setName(shown), [shown]);
  const Icon = typeIcon(c.icon);
  const commit = () => {
    const n = name.trim();
    if (!n) setName(shown);
    else if (n !== shown && n !== c.name) store.update('checkin_category', c.id, { name: n });
  };
  return (
    <li className={`cat-row${c.hidden ? ' is-hidden' : ''}`}>
      <Icon size={16} className="cat-row-icon" style={{ color: c.color }} aria-hidden />
      <TextField aria-label={tr('「{name}」的名字', { name: shown })} value={name} onChange={setName} className="cat-name">
        <Input className="input" onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
      </TextField>
      <span className="cat-row-actions">
        <IconButton label={c.hidden ? tr('显示「{name}」', { name: shown }) : tr('隐藏「{name}」', { name: shown })} onPress={() => store.update('checkin_category', c.id, { hidden: !c.hidden })}>
          {c.hidden ? <EyeOff size={16} /> : <Eye size={16} />}
        </IconButton>
        <IconButton label={tr('上移')} isDisabled={first} onPress={() => store.moveCheckInCategory(c.id, -1)}>
          <ArrowUp size={16} />
        </IconButton>
        <IconButton label={tr('下移')} isDisabled={last} onPress={() => store.moveCheckInCategory(c.id, 1)}>
          <ArrowDown size={16} />
        </IconButton>
      </span>
    </li>
  );
}
