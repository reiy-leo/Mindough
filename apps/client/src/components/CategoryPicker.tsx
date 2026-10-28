/**
 * 类型选择（Rei 2026-10-28「类型可以做成可搜索、多选的下拉列表」「一个任务可以关联多个类型」，docs/MULTI-TYPE.md）。
 * 任务属性胶囊「类型」、新建面板用多选；项目还是一个类型，用同一个列表的单选。
 *
 * - 顶上一个输入框：已选的类型是可删的小标签排在框里，后面接着打字搜（名字、英文名、拼音首字母都能搜，复用方案 C 的 category-prefs）。
 * - 不搜时：「常用」「最近用过」排在前面，其余按大类分组（身体、生活、学习和工作、爱好、人、其他）。
 * - 每行前面是勾选框，点一下勾上 / 去掉，列表不收起；单选点了就收起。
 * - 键盘：↑↓ 移动，回车勾选，输入框空着时退格去掉最后一个；Esc 关掉。
 * - 搜不到同名的：最后一行「新建类型“xxx”」，建好直接勾上。
 * - 底部「管理类型…」去侧栏「管理 → 类型」页。手机上整个面板从底部出来（.is-sheet）。
 * 不显示的类型不在列表里（已经挂着的照常显示成小标签）。
 */
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { Button as RacButton } from 'react-aria-components';
import { Check, ChevronDown, Plus, Search, X } from 'lucide-react';
import { PopoverPanel } from '../ui/primitives';
import { CATEGORY_GROUPS, categoryGroupOf, categoryIcon, categoryMatchRank, categoryMatches, dataEnglish, normCategoryName, type Category, type Store } from '@mindough/core';
import { typeIcon } from '../lib/icons';
import { navigate } from '../lib/router';
import { dataLabel, tr, trc } from '../lib/i18n';
import { categoryGroupLabel } from './CategoryEditor';

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

/** 几个类型连成一串小标签（列表、打卡卡片里用）。 */
export function CategoryLabels({ cats, size = 12 }: { cats: readonly Category[]; size?: number }) {
  return (
    <span className="cat-labels">
      {cats.map((c) => (
        <CategoryLabel key={c.id} c={c} size={size} />
      ))}
    </span>
  );
}

/** 「管理类型…」：去侧栏「管理 → 类型」页。 */
export function openCategoryPage() {
  navigate({ page: 'types' });
}

type Row = { kind: 'cat'; c: Category } | { kind: 'create'; name: string };
interface Section {
  key: string;
  label: string;
  rows: Row[];
}

/**
 * 类型列表（下拉面板的内容）。multiple = false 时是单选：点一下就选上并 onDone。
 * value：已选的 id（按顺序）。onChange 给出新的整组。
 */
export function CategoryList({
  store,
  value,
  onChange,
  multiple = true,
  onDone,
  autoFocus = true,
}: {
  store: Store;
  value: readonly string[];
  onChange: (ids: string[]) => void;
  multiple?: boolean;
  onDone?: () => void;
  autoFocus?: boolean;
}) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  const term = q.trim().toLowerCase();
  const selected = value.map((id) => store.category(id)).filter((c): c is Category => !!c);
  const isOn = (id: string) => selected.some((c) => c.id === id);

  const sections = useMemo<Section[]>(() => {
    const all = store.pickerCategories();
    if (term) {
      const order = new Map(all.map((c, i) => [c.id, i]));
      // 已选的不显示类型也搜得到（好去掉）
      const pool = [...all, ...selected.filter((c) => !all.some((x) => x.id === c.id))];
      const hits = pool
        .filter((c) => categoryMatches(categoryNames(c), term))
        .sort((a, b) => categoryMatchRank(categoryNames(a), term) - categoryMatchRank(categoryNames(b), term) || (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999));
      const exact = store.categories(true).some((c) => categoryNames(c).some((n) => normCategoryName(n) === normCategoryName(q)));
      const rows: Row[] = hits.map((c) => ({ kind: 'cat', c }));
      if (!exact && q.trim()) rows.push({ kind: 'create', name: q.trim() });
      return [{ key: 'hits', label: '', rows }];
    }
    const frequent = new Set(store.frequentCategoryIds());
    const last = store.categoryLastUsed();
    const overrides = store.categoryGroupOverrides();
    const top = all.filter((c) => frequent.has(c.id));
    const recent = all.filter((c) => !frequent.has(c.id) && last.has(c.id)).slice(0, 6);
    const used = new Set([...top, ...recent].map((c) => c.id));
    const out: Section[] = [];
    if (top.length) out.push({ key: 'frequent', label: trc('类型档', '常用'), rows: top.map((c) => ({ kind: 'cat', c })) });
    if (recent.length) out.push({ key: 'recent', label: tr('最近用过'), rows: recent.map((c) => ({ kind: 'cat', c })) });
    for (const g of CATEGORY_GROUPS) {
      const items = all.filter((c) => !used.has(c.id) && categoryGroupOf(c.id, overrides) === g);
      if (items.length) out.push({ key: g, label: categoryGroupLabel(g), rows: items.map((c) => ({ kind: 'cat', c })) });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, store.version, term, q, value.join(',')]);

  const rows = sections.flatMap((s) => s.rows);
  useEffect(() => setActive(0), [term]);
  useEffect(() => {
    if (!autoFocus) return;
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [autoFocus]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const toggle = (id: string) => {
    if (!multiple) {
      onChange(isOn(id) ? [] : [id]);
      onDone?.();
      return;
    }
    onChange(isOn(id) ? value.filter((x) => store.category(x)?.id !== id) : [...value, id]);
  };
  const choose = (r: Row | undefined) => {
    if (!r) return;
    if (r.kind === 'cat') toggle(r.c.id);
    else {
      const c = store.createCategory(r.name);
      setQ('');
      if (multiple) onChange([...value, c.id]);
      else {
        onChange([c.id]);
        onDone?.();
      }
    }
    if (term && multiple) setQ('');
    inputRef.current?.focus();
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => (rows.length ? (a + 1) % rows.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => (rows.length ? (a - 1 + rows.length) % rows.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(rows[active]);
    } else if (e.key === 'Backspace' && q === '' && selected.length && multiple) {
      e.preventDefault();
      onChange(value.slice(0, -1));
    }
  };
  const optId = (i: number) => `${listId}-${i}`;
  let index = -1;

  return (
    <div className="cat-select">
      <div className="cat-select-field" onClick={() => inputRef.current?.focus()}>
        <Search size={15} aria-hidden className="cat-select-icon" />
        {multiple &&
          selected.map((c) => (
            <span key={c.id} className="cat-token" style={{ '--chip-color': c.color } as CSSProperties}>
              <CategoryLabel c={c} size={12} />
              <RacButton className="cat-token-x" aria-label={tr('去掉{name}', { name: dataLabel(c.name) })} excludeFromTabOrder onPress={() => toggle(c.id)}>
                <X size={11} strokeWidth={2.5} aria-hidden />
              </RacButton>
            </span>
          ))}
        <input
          ref={inputRef}
          className="cat-select-input"
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={rows.length ? optId(active) : undefined}
          aria-label={tr('搜索类型')}
          placeholder={selected.length && multiple ? '' : tr('搜类型，比如“健康”“yd”')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
          spellCheck={false}
          autoComplete="off"
        />
      </div>
      <ul ref={listRef} id={listId} role="listbox" aria-multiselectable={multiple || undefined} aria-label={trc('分类', '类型')} className="cat-select-list">
        {sections.map((s) => (
          <SectionRows key={s.key} label={s.label}>
            {s.rows.map((r) => {
              index++;
              const i = index;
              if (r.kind === 'create')
                return (
                  <li key="create" id={optId(i)} data-index={i} role="option" aria-selected={false} className={`cat-option is-create${i === active ? ' is-active' : ''}`} onMouseMove={() => setActive(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(r)}>
                    <span className="cat-check" aria-hidden>
                      <Plus size={13} />
                    </span>
                    <span>{tr('新建类型“{name}”', { name: r.name })}</span>
                  </li>
                );
              const on = isOn(r.c.id);
              return (
                <li
                  key={`${s.key}-${r.c.id}`}
                  id={optId(i)}
                  data-index={i}
                  role="option"
                  aria-selected={on}
                  className={`cat-option${on ? ' is-on' : ''}${i === active ? ' is-active' : ''}`}
                  style={{ '--chip-color': r.c.color } as CSSProperties}
                  onMouseMove={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(r)}
                >
                  <span className={`cat-check${multiple ? '' : ' is-radio'}`} aria-hidden>
                    {on && <Check size={12} strokeWidth={3} />}
                  </span>
                  <CategoryLabel c={r.c} />
                </li>
              );
            })}
          </SectionRows>
        ))}
        {!rows.length && <li className="cat-select-empty">{tr('没有找到')}</li>}
      </ul>
      <div className="cat-select-foot">
        {!multiple && selected.length > 0 && (
          <RacButton
            className="link-btn"
            onPress={() => {
              onChange([]);
              onDone?.();
            }}
          >
            {tr('没有类型')}
          </RacButton>
        )}
        <span className="grow" />
        <RacButton className="cat-manage-link" onPress={openCategoryPage}>
          {tr('管理类型…')}
        </RacButton>
      </div>
    </div>
  );
}

function SectionRows({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      {label && (
        <li role="presentation" className="cat-select-group">
          {label}
        </li>
      )}
      {children}
    </>
  );
}

/** 单选（项目的类型）：value 一个 id。 */
export function CategoryPicker({ store, value, onChange, onDone }: { store: Store; value: string | null; onChange: (id: string | null) => void; onDone?: () => void; label?: boolean }) {
  return <CategoryList store={store} value={value ? [value] : []} multiple={false} onChange={(ids) => onChange(ids[0] ?? null)} {...(onDone ? { onDone } : {})} />;
}

/**
 * 表单里的类型一栏（新建面板、新建项目）：一个按钮，显示已选的类型小标签，点开是下拉列表。
 * multiple = false 时 value 只取第一个。
 */
export function CategoryField({ store, value, onChange, multiple = true, label = true }: { store: Store; value: readonly string[]; onChange: (ids: string[]) => void; multiple?: boolean; label?: boolean }) {
  const cats = value.map((id) => store.category(id)).filter((c): c is Category => !!c);
  return (
    <div className="field cat-field">
      {label && <span className="field-label">{trc('分类', '类型')}</span>}
      <PopoverPanel
        label={trc('分类', '类型')}
        className="is-wide is-sheet cat-select-pop"
        trigger={
          <RacButton className="input select-btn cat-current" aria-label={cats.length ? tr('类型：{value}', { value: cats.map((c) => dataLabel(c.name)).join(tr('、')) }) : tr('选类型')}>
            {cats.length ? <CategoryLabels cats={cats} size={13} /> : <span className="muted">{tr('没有类型')}</span>}
            <ChevronDown size={16} aria-hidden />
          </RacButton>
        }
      >
        {(close) => <CategoryList store={store} value={value} multiple={multiple} onChange={onChange} onDone={close} />}
      </PopoverPanel>
    </div>
  );
}
