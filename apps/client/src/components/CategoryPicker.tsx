/**
 * 类型（统一的分类，Rei 2026-10-26）的标签和单选。任务属性胶囊「类型」、新建面板、项目都用这一个。
 * 顺序不靠手排（方案 C，Rei 2026-10-28 定「用「常用 + 最近用过」代替手动排序」）：标成「常用」的在前，其余按最近用过排（core orderPickerCategories）。
 * 第一屏放常用的（不足 6 个用最近用过的补齐）+ 当前选中的 + 「更多」；点「更多」展开搜索框和其余类型，名字、英文名、拼音首字母都能搜。
 * 不显示的不在里面（当前挂着的除外）。底部「管理类型…」去侧栏「管理 → 类型」页（设置里不再有类型，Rei 2026-10-28）。
 */
import { useState, type CSSProperties, type ReactNode } from 'react';
import { Button as RacButton, Input, SearchField, ToggleButton, ToggleButtonGroup } from 'react-aria-components';
import { ChevronDown, Search } from 'lucide-react';
import { categoryIcon, categoryMatchRank, categoryMatches, dataEnglish, type Category, type Store } from '@mindough/core';
import { typeIcon } from '../lib/icons';
import { navigate } from '../lib/router';
import { dataLabel, tr, trc } from '../lib/i18n';

export const NO_CATEGORY = '__none';

/** 搜索用的几个名字：存着的、当前语言的、英文的。 */
export const categoryNames = (c: Pick<Category, 'name'>) => [c.name, dataLabel(c.name), dataEnglish(c.name)];

/** 类型小标签：图标 + 名称，颜色跟随类型。 */
export function CategoryLabel({ c, size = 13 }: { c: Category; size?: number }) {
  const Icon = typeIcon(categoryIcon(c));
  return (
    <span className="cat-label" style={{ color: c.color }}>
      <Icon size={size} aria-hidden />
      <span>{dataLabel(c.name)}</span>
    </span>
  );
}

/** 「管理类型…」：去侧栏「管理 → 类型」页。 */
export function openCategoryPage() {
  navigate({ page: 'types' });
}

/** 类型单选。compact：先显示当前类型，点开再出网格。label = false 时不显示上面的小标题（胶囊弹层里用）。 */
export function CategoryPicker({ store, value, onChange, compact, label = true }: { store: Store; value: string | null; onChange: (id: string | null) => void; compact?: boolean; label?: boolean }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(!compact);
  const cur = store.category(value);
  const cats = store.pickerCategories();
  const frequent = store.frequentCategories(6);
  // 已选但不在常用里（或者不显示）的类型也放进第一屏，免得“看不见当前值”
  const first = cur && !frequent.some((c) => c.id === cur.id) ? [...frequent, cur] : frequent;
  const rest = cats.filter((c) => !first.some((f) => f.id === c.id));
  const [more, setMore] = useState(false);
  const term = q.trim().toLowerCase();
  const all = cur && cur.hidden ? [...cats, cur] : cats;
  const matches = term ? all.filter((c) => categoryMatches(categoryNames(c), term)).sort((a, b) => categoryMatchRank(categoryNames(a), term) - categoryMatchRank(categoryNames(b), term)) : null;
  const pick = (id: string | null) => {
    onChange(id);
    if (compact) setOpen(false);
  };
  const tile = (c: Category) => (
    <ToggleButton key={c.id} id={c.id} className="cat-tile" style={{ '--chip-color': c.color } as CSSProperties}>
      <CategoryLabel c={c} />
    </ToggleButton>
  );
  const group = (aria: string, children: ReactNode) => (
    <ToggleButtonGroup
      aria-label={aria}
      className="cat-grid"
      selectionMode="single"
      disallowEmptySelection={false}
      selectedKeys={[cur?.id ?? NO_CATEGORY]}
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
      {label && <span className="field-label">{trc('分类', '类型')}</span>}
      {compact && (
        <RacButton className="input select-btn cat-current" onPress={() => setOpen((o) => !o)} aria-expanded={open}>
          {cur ? <CategoryLabel c={cur} /> : <span className="muted">{tr('没有类型')}</span>}
          <ChevronDown size={16} aria-hidden />
        </RacButton>
      )}
      {open && (
        <div className="cat-picker-body">
          {matches ? null : (
            <div className="cat-flow">
              {group(
                tr('常用类型'),
                <>
                  <ToggleButton id={NO_CATEGORY} className="cat-tile cat-none">
                    {tr('没有类型')}</ToggleButton>
                  {first.map(tile)}
                </>,
              )}
              {rest.length > 0 && (
                <RacButton className="cat-more" aria-expanded={more} onPress={() => setMore((m) => !m)}>
                  {more ? tr('收起') : tr('更多 · {length}', { length: rest.length })}
                  <ChevronDown size={14} aria-hidden className={more ? 'flip' : undefined} />
                </RacButton>
              )}
            </div>
          )}
          {(more || matches) && (
            <SearchField aria-label={tr('搜索类型')} value={q} onChange={setQ} className="cat-search" autoFocus={more && !compact}>
              <Search size={14} aria-hidden className="cat-search-icon" />
              <Input className="input" placeholder={tr('搜类型，比如“健康”“工作”')} />
            </SearchField>
          )}
          {matches ? (matches.length > 0 && group(tr('搜到的类型'), matches.map(tile))) : more && group(tr('更多类型'), rest.map(tile))}
          {matches && !matches.length && <p className="muted small">{tr('没有叫“{q}”的类型，可以在「管理类型…」里添加。', { q })}</p>}
          <RacButton className="cat-manage-link" onPress={openCategoryPage}>
            {tr('管理类型…')}</RacButton>
        </div>
      )}
    </div>
  );
}
