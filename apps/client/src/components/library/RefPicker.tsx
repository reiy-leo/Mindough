/**
 * 任务的「资料」（Rei 2026-10-28「一个任务可以连多个资料库的资料，例如：可以同时几个人和一部电影」；
 * 同日「类型是类型，资料库是资料库，是平级的」，docs/MULTI-TYPE.md）。
 *
 * - RefPicker：挑资料的面板。顶上一排库（全部 / 影视 / 游戏 / 书 / 人物…）；
 *   「全部」跨库搜库里已有的；选了某个库，就是原来的资料选择框（模糊搜、在线找、新建“xxx”）。
 *   多选：点一下挂上，再点一下去掉，面板不收起。人物库的「资料」就是人物关联。
 * - RefList：已挂的资料按库分组显示（详情、新建面板共用）：库名一行，下面一条一行，行尾 × 去掉（只解开关联，资料留在库里）。
 */
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Button as RacButton, ToggleButton, ToggleButtonGroup } from 'react-aria-components';
import { Check, Search, X } from 'lucide-react';
import { isPersonLibrary, libraryCopy, searchLibrary, type LibraryEntry, type LookupResult, type Store, type TaskType } from '@mindough/core';
import { typeIcon } from '../../lib/icons';
import { dataLabel, tr } from '../../lib/i18n';
import { createItemFromLookup } from '../../lib/lookup';
import { ItemSheet, LibraryPicker, artShape, entryArt } from './Library';

const ALL = '__all';

export interface RefKey {
  kind: LibraryEntry['kind'];
  id: string;
}

export function RefPicker({
  store,
  selected,
  onToggle,
  defaultLibrary,
  onCreatedOnline,
}: {
  store: Store;
  /** 已挂的资料 / 人物 id。 */
  selected: ReadonlySet<string>;
  onToggle: (entry: RefKey, on: boolean) => void;
  /** 一打开先选哪个库（项目的默认资料库）；不给就是「全部」。 */
  defaultLibrary?: string | null;
  /** 从在线结果新建了一条资料（新建面板用来在取消时删掉没用上的）。 */
  onCreatedOnline?: (id: string) => void;
}) {
  const libs = store.refLibraries();
  const [lib, setLib] = useState<string>(defaultLibrary && libs.some((t) => t.id === defaultLibrary) ? defaultLibrary : ALL);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState<{ type: TaskType; name: string } | null>(null);
  const type = lib === ALL ? undefined : libs.find((t) => t.id === lib);
  const toggle = (e: Pick<LibraryEntry, 'kind' | 'id'>) => onToggle({ kind: e.kind, id: e.id }, !selected.has(e.id));

  return (
    <div className="ref-picker">
      <ToggleButtonGroup
        aria-label={tr('从哪个库挑')}
        className="ref-libs"
        selectionMode="single"
        disallowEmptySelection
        selectedKeys={[lib]}
        onSelectionChange={(keys) => {
          const k = [...keys][0];
          if (k !== undefined) setLib(String(k));
        }}
      >
        <ToggleButton id={ALL} className="ref-lib">
          {tr('全部')}
        </ToggleButton>
        {libs.map((t) => {
          const Icon = typeIcon(t.icon);
          return (
            <ToggleButton key={t.id} id={t.id} className="ref-lib" style={{ '--chip-color': t.color } as CSSProperties}>
              <Icon size={13} aria-hidden />
              {dataLabel(t.name)}
            </ToggleButton>
          );
        })}
      </ToggleButtonGroup>
      {type ? (
        <LibraryPicker
          key={type.id}
          store={store}
          type={type}
          query={query}
          onQueryChange={setQuery}
          selected={selected}
          autoFocus
          className="in-popover"
          onPick={(e) => toggle(e)}
          onCreate={(name) => setCreating({ type, name })}
          {...(isPersonLibrary(type)
            ? {}
            : {
                onPickOnline: (r: LookupResult) => {
                  const { id, created } = createItemFromLookup(store, type, r);
                  if (created) onCreatedOnline?.(id);
                  if (!selected.has(id)) onToggle({ kind: 'item', id }, true);
                  setQuery('');
                },
              })}
        />
      ) : (
        <AllLibraries store={store} libs={libs} query={query} onQueryChange={setQuery} selected={selected} onPick={toggle} />
      )}
      {creating && (
        <ItemSheet
          store={store}
          type={creating.type}
          initialName={creating.name}
          onClose={() => setCreating(null)}
          onSaved={(id) => {
            onToggle({ kind: isPersonLibrary(creating.type) ? 'person' : 'item', id }, true);
            setQuery('');
          }}
        />
      )}
    </div>
  );
}

/** 「全部」：跨库搜库里已有的资料（在线找、新建要先选库）。 */
function AllLibraries({
  store,
  libs,
  query,
  onQueryChange,
  selected,
  onPick,
}: {
  store: Store;
  libs: TaskType[];
  query: string;
  onQueryChange: (q: string) => void;
  selected: ReadonlySet<string>;
  onPick: (e: LibraryEntry) => void;
}) {
  const typeOf = useMemo(() => new Map(libs.map((t) => [t.id, t])), [libs]);
  const all = useMemo(() => libs.flatMap((t) => store.libraryEntries(t.id)), [libs, store, store.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const results = useMemo(() => searchLibrary(all, query, 40), [all, query]);
  const [active, setActive] = useState(0);
  return (
    <div className="lib-picker in-popover">
      <div className="lib-picker-field">
        <Search size={17} className="lib-picker-icon" aria-hidden />
        <input
          className="lib-picker-input"
          role="combobox"
          aria-expanded
          aria-label={tr('搜所有资料库…')}
          placeholder={tr('搜所有资料库…')}
          value={query}
          autoFocus
          onChange={(e) => {
            onQueryChange(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => (results.length ? (a + 1) % results.length : 0));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => (results.length ? (a - 1 + results.length) % results.length : 0));
            } else if (e.key === 'Enter' && !e.nativeEvent.isComposing && results[active]) {
              e.preventDefault();
              onPick(results[active]);
            }
          }}
          spellCheck={false}
          autoComplete="off"
        />
      </div>
      <ul role="listbox" aria-multiselectable aria-label={tr('资料')} className="lib-picker-list">
        {!query.trim() && results.length > 0 && (
          <li role="presentation" className="lib-picker-group">
            {tr('最近')}
          </li>
        )}
        {results.map((e, i) => {
          const t = typeOf.get(e.type_id)!;
          const Icon = typeIcon(t.icon);
          const on = selected.has(e.id);
          return (
            <li
              key={`${e.type_id}-${e.id}`}
              role="option"
              data-index={i}
              aria-selected={i === active}
              aria-checked={on}
              className={`lib-option${i === active ? ' is-active' : ''}`}
              onMouseMove={() => setActive(i)}
              onMouseDown={(ev) => ev.preventDefault()}
              onClick={() => onPick(e)}
            >
              {entryArt(store, e, artShape(t), 'lib-option-art')}
              <span className="lib-option-text">
                <span className="lib-option-name">{e.name}</span>
                <span className="lib-option-sub ref-option-lib" style={{ color: t.color }}>
                  <Icon size={11} aria-hidden />
                  {dataLabel(t.name)}
                  {e.subtitle ? <span className="muted"> · {e.subtitle}</span> : null}
                </span>
              </span>
              <span className={`lib-option-check${on ? ' is-on' : ''}`} aria-hidden>
                {on && <Check size={12} strokeWidth={3} />}
              </span>
            </li>
          );
        })}
        {!results.length && <li className="lib-picker-empty">{query.trim() ? tr('没有找到。要在线找或新建，先在上面选一个库。') : tr('资料库都还是空的，先在上面选一个库再添加。')}</li>}
      </ul>
    </div>
  );
}

/**
 * 已挂的资料，按库分组。onOpen：点一条（详情里弹出资料卡）；onRemove：行尾 ×。
 * extra(type)：每组下面接的东西（详情里放这个库的任务字段）。
 */
export function RefList({
  store,
  groups,
  onRemove,
  renderEntry,
  extra,
}: {
  store: Store;
  groups: Array<{ type: TaskType; entries: LibraryEntry[] }>;
  onRemove: (e: LibraryEntry) => void;
  /** 自定义一条的主体（详情里是能点开资料卡的按钮）；不给就是图 + 名字。 */
  renderEntry?: (e: LibraryEntry, type: TaskType) => ReactNode;
  extra?: (type: TaskType) => ReactNode;
}) {
  return (
    <div className="ref-list">
      {groups.map(({ type, entries }) => {
        const Icon = typeIcon(type.icon);
        return (
          <section key={type.id} className="ref-group" aria-label={dataLabel(type.name)} style={{ '--chip-color': type.color } as CSSProperties}>
            <div className="ref-group-head">
              <Icon size={13} aria-hidden />
              <span>{libraryCopy(type).name}</span>
            </div>
            {entries.map((e) => (
              <div key={e.id} className="ref-row">
                {renderEntry ? (
                  renderEntry(e, type)
                ) : (
                  <span className="ref-entry">
                    {entryArt(store, e, artShape(type), 'ref-entry-art')}
                    <span className="ref-entry-name">{e.name}</span>
                  </span>
                )}
                <RacButton className="icon-btn ref-remove" aria-label={tr('不再关联「{name}」', { name: e.name })} onPress={() => onRemove(e)}>
                  <X size={14} aria-hidden />
                </RacButton>
              </div>
            ))}
            {extra?.(type)}
          </section>
        );
      })}
    </div>
  );
}
