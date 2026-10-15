import { useState, type CSSProperties } from 'react';
import { Button as RacButton, Input, SearchField, ToggleButton, ToggleButtonGroup } from 'react-aria-components';
import { ChevronDown, Search } from 'lucide-react';
import type { CheckInCategory, Store } from '@mindough/core';
import { typeIcon } from '../lib/icons';

export const NO_CATEGORY = '__none';

/** 分类小标签：图标 + 名称，颜色跟随分类。 */
export function CategoryLabel({ c, size = 13 }: { c: CheckInCategory; size?: number }) {
  const Icon = typeIcon(c.icon);
  return (
    <span className="cat-label" style={{ color: c.color }}>
      <Icon size={size} aria-hidden />
      <span>{c.name}</span>
    </span>
  );
}

/**
 * 打卡分类单选（新建 / 编辑重复任务用）：可搜索的网格。分类多（内置 27 个），所以不用下拉。
 * compact：先显示当前分类，点开再出网格（任务详情里用）。
 */
export function CategoryPicker({ store, value, onChange, compact }: { store: Store; value: string | null; onChange: (id: string | null) => void; compact?: boolean }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(!compact);
  const cur = value ? store.get('checkin_category', value) : undefined;
  const cats = store.checkInCategories();
  // 已选但被隐藏的分类仍列出，免得“看不见当前值”
  const all = cur && cur.hidden ? [...cats, cur] : cats;
  const term = q.trim().toLowerCase();
  const shown = term ? all.filter((c) => c.name.toLowerCase().includes(term)) : all;
  const pick = (id: string | null) => {
    onChange(id);
    if (compact) setOpen(false);
  };
  return (
    <div className="field cat-picker">
      <span className="field-label">打卡分类</span>
      {compact && (
        <RacButton className="input select-btn cat-current" onPress={() => setOpen((o) => !o)} aria-expanded={open}>
          {cur ? <CategoryLabel c={cur} /> : <span className="muted">未分类</span>}
          <ChevronDown size={16} aria-hidden />
        </RacButton>
      )}
      {open && (
        <div className="cat-picker-body">
          <SearchField aria-label="搜索打卡分类" value={q} onChange={setQ} className="cat-search">
            <Search size={14} aria-hidden className="cat-search-icon" />
            <Input className="input" placeholder="搜索分类，如“健康”“理财”" />
          </SearchField>
          <ToggleButtonGroup
            aria-label="打卡分类"
            className="cat-grid"
            selectionMode="single"
            selectedKeys={[value ?? NO_CATEGORY]}
            onSelectionChange={(keys) => {
              const k = [...keys][0];
              if (k !== undefined) pick(String(k) === NO_CATEGORY ? null : String(k));
            }}
          >
            {!term && (
              <ToggleButton id={NO_CATEGORY} className="cat-tile">
                <span className="muted">未分类</span>
              </ToggleButton>
            )}
            {shown.map((c) => (
              <ToggleButton key={c.id} id={c.id} className="cat-tile" style={{ '--chip-color': c.color } as CSSProperties}>
                <CategoryLabel c={c} />
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          {term && !shown.length && <p className="muted small">没有叫“{q}”的分类，可以在 设置 → 打卡分类 里新增。</p>}
        </div>
      )}
    </div>
  );
}
