import { useState, type CSSProperties, type ReactNode } from 'react';
import { Button as RacButton, Input, SearchField, ToggleButton, ToggleButtonGroup } from 'react-aria-components';
import { ChevronDown, Search } from 'lucide-react';
import type { CheckInCategory, Store } from '@mindough/core';
import { typeIcon } from '../lib/icons';
import { CategoryManager } from './CategoryManager';

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
 * 打卡分类单选（新建 / 编辑重复任务用）。分类多（内置 27 个），第一屏只放「常用」6 个（按用到的件数，不够用默认补齐）
 * + 当前选中的 + 「更多」；点「更多」展开搜索框和其余分类。
 * compact：先显示当前分类，点开再出网格（任务详情里用）。
 */
export function CategoryPicker({ store, value, onChange, compact }: { store: Store; value: string | null; onChange: (id: string | null) => void; compact?: boolean }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(!compact);
  const cur = value ? store.get('checkin_category', value) : undefined;
  const cats = store.checkInCategories();
  const frequent = store.frequentCheckInCategories(6);
  // 已选但不在常用里（或被隐藏）的分类也放进第一屏，免得“看不见当前值”
  const first = cur && !frequent.some((c) => c.id === cur.id) ? [...frequent, cur] : frequent;
  const rest = cats.filter((c) => !first.some((f) => f.id === c.id));
  const [more, setMore] = useState(false);
  const [managing, setManaging] = useState(false);
  const term = q.trim().toLowerCase();
  const all = cur && cur.hidden ? [...cats, cur] : cats;
  const matches = term ? all.filter((c) => c.name.toLowerCase().includes(term)) : null;
  const pick = (id: string | null) => {
    onChange(id);
    if (compact) setOpen(false);
  };
  const tile = (c: CheckInCategory) => (
    <ToggleButton key={c.id} id={c.id} className="cat-tile" style={{ '--chip-color': c.color } as CSSProperties}>
      <CategoryLabel c={c} />
    </ToggleButton>
  );
  const group = (label: string, children: ReactNode) => (
    <ToggleButtonGroup
      aria-label={label}
      className="cat-grid"
      selectionMode="single"
      disallowEmptySelection={false}
      selectedKeys={[value ?? NO_CATEGORY]}
      onSelectionChange={(keys) => {
        const k = [...keys][0];
        if (k !== undefined) pick(String(k) === NO_CATEGORY ? null : String(k));
      }}
    >
      {children}
    </ToggleButtonGroup>
  );
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
          {matches ? null : (
            <>
              <div className="cat-flow">
                {group(
                  '常用打卡分类',
                  <>
                    <ToggleButton id={NO_CATEGORY} className="cat-tile cat-none">
                      未分类
                    </ToggleButton>
                    {first.map(tile)}
                  </>,
                )}
                {rest.length > 0 && (
                  <RacButton className="cat-more" aria-expanded={more} onPress={() => setMore((m) => !m)}>
                    {more ? '收起' : `更多 · ${rest.length}`}
                    <ChevronDown size={14} aria-hidden className={more ? 'flip' : undefined} />
                  </RacButton>
                )}
              </div>
            </>
          )}
          {(more || matches) && (
            <SearchField aria-label="搜索打卡分类" value={q} onChange={setQ} className="cat-search" autoFocus={more && !compact}>
              <Search size={14} aria-hidden className="cat-search-icon" />
              <Input className="input" placeholder="搜分类，比如“健康”“理财”" />
            </SearchField>
          )}
          {matches ? (matches.length > 0 && group('搜到的打卡分类', matches.map(tile))) : more && group('更多打卡分类', rest.map(tile))}
          {matches && !matches.length && <p className="muted small">没有叫“{q}”的分类，可以在「管理分类…」里添加。</p>}
          <RacButton className="cat-manage-link" onPress={() => setManaging(true)}>
            管理分类…
          </RacButton>
        </div>
      )}
      <CategoryManager isOpen={managing} onOpenChange={setManaging} />
    </div>
  );
}
