/**
 * 类型列表（docs/CATEGORY-EDITOR.md 方案 C，Rei 2026-10-28「按方案C执行」）。只在侧栏「管理 → 类型」页（pages/Categories.tsx）用；
 * 设置里不再有类型（Rei 2026-10-28「去掉设置中的入口」）。
 *
 * - 顶上搜索框：打开就聚焦；名字、英文名、拼音首字母都能搜；↑↓ 选、回车打开；没有同名的时最后一行「新建“xxx”」。
 * - 不搜时按大类分组（身体、生活、学习和工作、爱好、人、其他），组能折叠；「不显示」的沉到最底下一组，变灰。
 * - 每行只有彩色图标块、名字、用了几次，没有按钮。顺序不用手排（Rei 2026-10-28 定：用「常用 + 最近用过」代替手动排序）。
 * - 手机上左滑一行出「常用」「不显示」。
 * 类型不能删：不想看到就设成不显示（挂着的任务照常显示）。
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { Button as RacButton, Input, SearchField } from 'react-aria-components';
import { ChevronDown, Plus, Search } from 'lucide-react';
import { CATEGORY_GROUPS, categoryGroupOf, categoryIcon, categoryMatchRank, categoryMatches, normCategoryName, type Category, type CategoryGroup, type CategoryState, type Store } from '@mindough/core';
import { typeIcon } from '../lib/icons';
import { categoryNames } from './CategoryPicker';
import { useStore } from '../store/StoreProvider';
import { useUi } from '../lib/ui';
import { dataLabel, tr, trc } from '../lib/i18n';

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

/** 大类的名字。 */
export function categoryGroupLabel(g: CategoryGroup): string {
  switch (g) {
    case 'body':
      return trc('类型大类', '身体');
    case 'life':
      return trc('类型大类', '生活');
    case 'study':
      return trc('类型大类', '学习和工作');
    case 'hobby':
      return trc('类型大类', '爱好');
    case 'people':
      return trc('类型大类', '人');
    default:
      return trc('类型大类', '其他');
  }
}

/** 三档的名字。 */
export function categoryStateLabel(s: CategoryState): string {
  return s === 'frequent' ? trc('类型档', '常用') : s === 'normal' ? trc('类型档', '普通') : trc('类型档', '不显示');
}

/** 彩色图标块：圆角方块，底色是类型颜色，图标白色（方案 C：去掉旁边的颜色圆点）。 */
export function CategoryBadge({ c, size = 28 }: { c: Pick<Category, 'icon' | 'color'>; size?: number }) {
  const Icon = typeIcon(categoryIcon(c));
  return (
    <span className="cat-badge" style={{ '--chip-color': c.color, width: size, height: size } as CSSProperties} aria-hidden>
      <Icon size={Math.round(size * 0.58)} />
    </span>
  );
}

/** 改档 / 换组 / 新建，带「撤销」提示条。 */
export function useCategoryActions() {
  const store = useStore();
  const ui = useUi();
  const setState = (id: string, state: CategoryState) => {
    const c = store.category(id);
    if (!c) return;
    const prev = store.setCategoryState(id, state);
    if (prev === state) return;
    const name = dataLabel(c.name);
    const message =
      state === 'frequent' ? tr('已把「{name}」设成常用', { name }) : state === 'hidden' ? tr('已把「{name}」设成不显示', { name }) : tr('已把「{name}」设成普通', { name });
    ui.toast({ message, actions: [{ label: tr('撤销'), onPress: () => store.setCategoryState(id, prev) }] }, 5000);
  };
  const setGroup = (id: string, group: CategoryGroup) => {
    const c = store.category(id);
    if (!c) return;
    const prev = store.categoryGroup(id);
    if (prev === group) return;
    store.setCategoryGroup(id, group);
    ui.toast({ message: tr('已把「{name}」放进「{group}」', { name: dataLabel(c.name), group: categoryGroupLabel(group) }), actions: [{ label: tr('撤销'), onPress: () => store.setCategoryGroup(id, prev) }] }, 5000);
  };
  return { setState, setGroup };
}

type Row = { kind: 'cat'; c: Category } | { kind: 'create'; name: string };

export interface CategoryListProps {
  selectedId: string | null;
  /** 点一行 / 回车：打开详情。 */
  onOpen: (id: string) => void;
  /** 键盘高亮的那行变了（类型页的 ⌘1/2/3 改它）。 */
  onActive?: (id: string | null) => void;
  /** 手机：左滑出按钮、不自动聚焦搜索框。 */
  mobile?: boolean;
  searchRef?: RefObject<HTMLInputElement | null>;
}

export function CategoryList({ selectedId, onOpen, onActive, mobile, searchRef }: CategoryListProps) {
  const store = useStore();
  const ui = useUi();
  const { setState } = useCategoryActions();
  const [q, setQ] = useState('');
  const [active, setActive] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [swiped, setSwiped] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const all = store.categories(true);
  const counts = categoryUsage(store);
  const frequent = store.frequentCategoryIds();
  const overrides = store.categoryGroupOverrides();
  const term = q.trim();

  // 搜索结果：对得上的（不显示的也搜得到，好改回来），开头对上的在前；没有同名的就加一行「新建」
  const matches = useMemo(() => {
    if (!term) return null;
    const order = new Map(store.pickerCategories().map((c, i) => [c.id, i]));
    return all
      .filter((c) => categoryMatches(categoryNames(c), term))
      .sort((a, b) => categoryMatchRank(categoryNames(a), term) - categoryMatchRank(categoryNames(b), term) || (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999));
  }, [all, term, store]);
  const exact = term ? all.find((c) => categoryNames(c).some((n) => normCategoryName(n) === normCategoryName(term))) : undefined;

  // 分组：大类按顺序，组里常用的在前、再按原来的顺序；不显示的单独一组在最后
  const sections = useMemo(() => {
    const out: { key: string; label: string; items: Category[] }[] = [];
    const vis = all.filter((c) => !c.hidden);
    for (const g of CATEGORY_GROUPS) {
      const items = vis.filter((c) => categoryGroupOf(c.id, overrides) === g);
      items.sort((a, b) => Number(frequent.includes(b.id)) - Number(frequent.includes(a.id)));
      if (items.length) out.push({ key: g, label: categoryGroupLabel(g), items });
    }
    const hidden = all.filter((c) => c.hidden);
    if (hidden.length) out.push({ key: 'hidden', label: trc('类型档', '不显示'), items: hidden });
    return out;
  }, [all, overrides, frequent]);

  const rows: Row[] = matches
    ? [...matches.map((c) => ({ kind: 'cat' as const, c })), ...(exact ? [] : [{ kind: 'create' as const, name: term }])]
    : sections.flatMap((s) => (collapsed.has(s.key) ? [] : s.items.map((c) => ({ kind: 'cat' as const, c }))));
  const rowId = (r: Row) => (r.kind === 'cat' ? r.c.id : 'create');
  const activeIndex = rows.findIndex((r) => rowId(r) === active);

  useEffect(() => onActive?.(active && active !== 'create' ? active : null), [active, onActive]);
  // 搜索词变了：高亮第一行
  useEffect(() => {
    setActive(term ? (rows[0] ? rowId(rows[0]) : null) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term]);
  // 高亮的那行滚进视野
  useEffect(() => {
    if (!active) return;
    listRef.current?.querySelector(`[data-row="${CSS.escape(active)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const create = (name: string) => {
    const taken = store.categoryNameTaken(name);
    const c = store.createCategory(name);
    setQ('');
    onOpen(c.id);
    if (!taken) ui.toast({ tone: 'success', message: tr('已新建「{name}」', { name: dataLabel(c.name) }) }, 3000);
  };
  const press = (r: Row) => (r.kind === 'cat' ? onOpen(r.c.id) : create(r.name));

  const onSearchKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!rows.length) return;
      const d = e.key === 'ArrowDown' ? 1 : -1;
      const i = activeIndex < 0 ? (d > 0 ? 0 : rows.length - 1) : Math.min(rows.length - 1, Math.max(0, activeIndex + d));
      setActive(rowId(rows[i]!));
    } else if (e.key === 'Enter') {
      const r = rows[activeIndex] ?? (term ? rows[0] : undefined);
      if (r) {
        e.preventDefault();
        press(r);
      }
    }
  };

  const toggleSection = (key: string) =>
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  const row = (c: Category) => (
    <CategoryRow
      key={c.id}
      c={c}
      count={counts.get(c.id) ?? 0}
      state={c.hidden ? 'hidden' : frequent.includes(c.id) ? 'frequent' : 'normal'}
      selected={selectedId === c.id}
      active={active === c.id}
      mobile={!!mobile}
      swiped={swiped === c.id}
      onSwipe={(open) => setSwiped(open ? c.id : null)}
      onPress={() => {
        setActive(c.id);
        onOpen(c.id);
      }}
      onState={(s) => {
        setSwiped(null);
        setState(c.id, s);
      }}
    />
  );

  return (
    <div className="cat-list">
      <SearchField aria-label={tr('搜索类型')} value={q} onChange={setQ} className="cat-search cat-list-search" autoFocus={!mobile}>
        <Search size={14} aria-hidden className="cat-search-icon" />
        <Input
          ref={searchRef}
          className="input"
          placeholder={tr('搜类型，或者输入名字新建')}
          role="combobox"
          aria-expanded
          aria-controls="cat-list-rows"
          aria-activedescendant={active ? `cat-row-${active}` : undefined}
          onKeyDown={onSearchKey}
        />
      </SearchField>
      <div className="cat-list-rows" id="cat-list-rows" role="listbox" aria-label={trc('分类', '类型')} ref={listRef}>
        {matches ? (
          <>
            {matches.map(row)}
            {!exact && (
              <div
                id="cat-row-create"
                data-row="create"
                role="option"
                aria-selected={active === 'create'}
                className={`cat-item cat-item-create${active === 'create' ? ' is-active' : ''}`}
                onClick={() => create(term)}
              >
                <span className="cat-badge cat-badge-add" aria-hidden>
                  <Plus size={16} />
                </span>
                <span className="cat-item-name">{tr('新建“{q}”', { q: term })}</span>
              </div>
            )}
          </>
        ) : (
          sections.map((s) => (
            <div key={s.key} className={`cat-section${s.key === 'hidden' ? ' is-hidden-group' : ''}`} role="group" aria-label={s.label}>
              <RacButton className="cat-section-head" aria-expanded={!collapsed.has(s.key)} onPress={() => toggleSection(s.key)}>
                <ChevronDown size={14} aria-hidden className={collapsed.has(s.key) ? 'is-collapsed' : undefined} />
                <span className="cat-section-label">{s.label}</span>
                <span className="cat-section-count">{s.items.length}</span>
              </RacButton>
              {!collapsed.has(s.key) && <div className="cat-section-rows">{s.items.map(row)}</div>}
            </div>
          ))
        )}
      </div>
      <p className="foot-note cat-list-note">
        {mobile ? tr('左滑一行可以设成常用或不显示。类型不能删，不想看到就设成不显示。') : tr('↑↓ 选，回车打开；{mod}1、{mod}2、{mod}3 切常用、普通、不显示。类型不能删。', { mod: modKey() })}
      </p>
    </div>
  );
}

/** ⌘（Mac）或 Ctrl。 */
export function modKey(): string {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl+';
}

const SWIPE_W = 168;

function CategoryRow({
  c,
  count,
  state,
  selected,
  active,
  mobile,
  swiped,
  onSwipe,
  onPress,
  onState,
}: {
  c: Category;
  count: number;
  state: CategoryState;
  selected: boolean;
  active: boolean;
  mobile: boolean;
  swiped: boolean;
  onSwipe: (open: boolean) => void;
  onPress: () => void;
  onState: (s: CategoryState) => void;
}) {
  const name = dataLabel(c.name);
  const drag = useRef<{ x: number; y: number; dx: number; on: boolean } | null>(null);
  const [dx, setDx] = useState(0);
  const offset = drag.current?.on ? dx : swiped ? -SWIPE_W : 0;
  const down = (e: ReactPointerEvent) => {
    if (!mobile || e.pointerType === 'mouse') return;
    drag.current = { x: e.clientX, y: e.clientY, dx: 0, on: false };
  };
  const move = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const mx = e.clientX - d.x;
    const my = e.clientY - d.y;
    if (!d.on) {
      if (Math.abs(my) > 10 && Math.abs(my) > Math.abs(mx)) {
        drag.current = null;
        return;
      }
      if (Math.abs(mx) < 10) return;
      d.on = true;
    }
    d.dx = Math.min(0, Math.max(-SWIPE_W - 24, mx + (swiped ? -SWIPE_W : 0)));
    setDx(d.dx);
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    if (!d?.on) return;
    onSwipe(d.dx < -SWIPE_W / 2);
    setDx(0);
    suppressClick.current = true;
  };
  const suppressClick = useRef(false);
  const label = count ? tr('{name}，用了 {n} 次', { name, n: count }) : name;
  return (
    <div className={`cat-item-wrap${swiped ? ' is-swiped' : ''}${drag.current?.on ? ' is-dragging' : ''}`}>
      {mobile && (
        <div className="cat-swipe-actions" aria-hidden={!swiped}>
          <button type="button" className="cat-swipe-btn is-frequent" tabIndex={swiped ? 0 : -1} onClick={() => onState(state === 'frequent' ? 'normal' : 'frequent')}>
            {state === 'frequent' ? tr('取消常用') : trc('类型档', '常用')}
          </button>
          <button type="button" className="cat-swipe-btn is-hide" tabIndex={swiped ? 0 : -1} onClick={() => onState(state === 'hidden' ? 'normal' : 'hidden')}>
            {state === 'hidden' ? tr('显示') : trc('类型档', '不显示')}
          </button>
        </div>
      )}
      <div
        id={`cat-row-${c.id}`}
        data-row={c.id}
        role="option"
        aria-selected={selected || active}
        aria-label={label}
        tabIndex={-1}
        className={`cat-item${state === 'hidden' ? ' is-hidden' : ''}${selected ? ' is-selected' : ''}${active ? ' is-active' : ''}`}
        style={offset ? ({ transform: `translateX(${offset}px)` } as CSSProperties) : undefined}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onClick={() => {
          if (suppressClick.current) {
            suppressClick.current = false;
            return;
          }
          if (swiped) return onSwipe(false);
          onPress();
        }}
      >
        <CategoryBadge c={c} />
        <span className="cat-item-name">{name}</span>
        {state === 'frequent' && <span className="cat-item-tag">{trc('类型档', '常用')}</span>}
        {count > 0 && <span className="cat-count">{count}</span>}
      </div>
    </div>
  );
}
