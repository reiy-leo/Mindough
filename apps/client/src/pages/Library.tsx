/**
 * 资料库：每个类型一个库（影视库、书库…、人物），按库切换；卡片网格（海报竖版 / 方形图标 / 横幅 / 圆形头像），
 * 搜索、添加；点开一条看它的资料和用到它的任务。文案见 docs/COPY.md「资料库」。
 */
import { useMemo, useRef, useState, type CSSProperties } from 'react';
import { Button as RacButton, Input, SearchField } from 'react-aria-components';
import { Check, ChevronLeft, Copy, ExternalLink, Library as LibraryIcon, Merge, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import {
  BUILTIN_TYPE_IDS,
  factFieldsOf,
  linkChips,
  fieldDisplay,
  fieldText,
  findLookupTwin,
  hasLibrary,
  isArchivedType,
  isFinished,
  isPersonLibrary,
  libraryCopy,
  lookupKindOf,
  searchLibrary,
  sourceOfFields,
  type LibraryEntry,
  type TaskType,
} from '@mindough/core';
import { useStore } from '../store/StoreProvider';
import { useSettings } from '../lib/settings';
import { useUi } from '../lib/ui';
import { href, navigate } from '../lib/router';
import { typeIcon } from '../lib/icons';
import { Button, ConfirmDialog, MenuAt, OverflowMenu, Section, useContextMenuAt } from '../ui/primitives';
import { librarySidebarAction } from '../lib/library-sidebar';
import { libraryRoute } from '../lib/nav';
import { PageHeader } from '../components/PageHeader';
import { TypeManager } from '../components/TypeManager';
import { TaskRow } from '../components/TaskRow';
import { Markdown } from '../components/Markdown';
import { ItemArt, ItemSheet, artShape, entryArt } from '../components/library/Library';
import { OnlineOptions, SourceNote } from '../components/library/Lookup';
import { createItemFromLookup, useOnlineSearch } from '../lib/lookup';
import { LinkChips } from '../components/library/LinkFields';
import { DuplicatesSheet, MergeIntoSheet, MergeSheet } from '../components/library/MergeSheet';
import { PersonDialog } from './People';
import { imageUrl } from '../lib/view';

import { dataLabel, tr } from '../lib/i18n';
function useLibraries(): TaskType[] {
  const store = useStore();
  // orderedTypes 已不含归档的类型
  return store.orderedTypes().filter((t) => hasLibrary(t));
}

/**
 * 资料卡。选择模式下点一下勾选；平时 ⌘ / Ctrl 点、或长按（手机）进入选择模式并选上这张。
 */
function Tile({ entry, type, onPress, selected, onSelect }: { entry: LibraryEntry; type: TaskType; onPress: () => void; selected?: boolean | undefined; onSelect: () => void }) {
  const store = useStore();
  const shape = artShape(type);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const long = useRef(false);
  const selecting = selected !== undefined;
  return (
    <RacButton
      className={`lib-tile shape-${shape}${selecting ? ' is-selecting' : ''}${selected ? ' is-selected' : ''}`}
      {...(selecting ? { 'aria-pressed': selected } : {})}
      onPressStart={(e) => {
        long.current = false;
        if (e.pointerType !== 'touch' || selecting) return;
        timer.current = setTimeout(() => {
          long.current = true;
          onSelect();
        }, 480);
      }}
      onPressEnd={() => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = null;
      }}
      onPress={(e) => {
        if (long.current) return;
        if (selecting || e.metaKey || e.ctrlKey) onSelect();
        else onPress();
      }}
    >
      {selecting && (
        <span className={`lib-tile-check${selected ? ' is-on' : ''}`} aria-hidden>
          {selected && <Check size={13} strokeWidth={3} />}
        </span>
      )}
      {entryArt(store, entry, shape, 'lib-tile-art')}
      <span className="lib-tile-text">
        <span className="lib-tile-name">{entry.name}</span>
        {(entry.subtitle || entry.uses > 0) && (
          <span className="lib-tile-sub">
            {[entry.subtitle, entry.uses > 0 ? tr('{uses} 件任务', { uses: entry.uses }) : ''].filter(Boolean).join(' · ')}
          </span>
        )}
      </span>
    </RacButton>
  );
}

/** 资料库标签：右键 / 长按出菜单（在侧边栏显示 / 取消在侧边栏显示）。 */
function LibTab({ type: t, active, onOpen }: { type: TaskType; active: boolean; onOpen: () => void }) {
  const store = useStore();
  const menu = useContextMenuAt();
  const TIcon = typeIcon(t.icon);
  const c = libraryCopy(t);
  const n = store.libraryEntries(t.id).length;
  return (
    <>
      <a
        href={href(libraryRoute(t.id))}
        className={`lib-tab${active ? ' is-active' : ''}`}
        aria-current={active ? 'page' : undefined}
        style={{ '--chip-color': t.color } as CSSProperties}
        {...menu.props}
        onClick={(e) => {
          if (menu.consumeLongPress()) {
            e.preventDefault();
            return;
          }
          onOpen();
        }}
      >
        <TIcon size={15} aria-hidden />
        <span>{c.short}</span>
        {n > 0 && <span className="lib-tab-count">{n}</span>}
      </a>
      <MenuAt at={menu.at} label={tr('资料库操作')} items={[librarySidebarAction(store, t)]} onClose={menu.close} />
    </>
  );
}

/**
 * 资料库页搜索框也在线找（Rei 2026-10-28「不可以在资料库中搜索框中添加影视、游戏么」）：
 * 本地结果下面列在线结果，点一条直接加进库并打开它；库里已有的同一条不再列出。
 */
function LibraryOnline({ type, query }: { type: TaskType; query: string }) {
  const store = useStore();
  const kind = lookupKindOf(type);
  const online = useOnlineSearch(kind, query);
  const results = useMemo(() => {
    const items = store.list('library_item');
    return online.results.filter((r) => !findLookupTwin(items, type.id, r));
  }, [online.results, store, store.version, type.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [active, setActive] = useState(-1);
  if (!kind || !query.trim()) return null;
  const choose = (i: number) => {
    const r = results[i];
    if (!r) return;
    const { id } = createItemFromLookup(store, type, r);
    navigate({ page: 'libitem', typeId: type.id, id });
  };
  return (
    <ul role="listbox" aria-label={libraryCopy(type).name} className="lib-picker-list lib-page-online">
      <OnlineOptions kind={kind} state={online} results={results} start={0} active={active} shape={artShape(type)} optId={(i) => `lib-online-${i}`} onHover={setActive} onChoose={choose} />
    </ul>
  );
}

export function LibraryPage({ typeId }: { typeId?: string }) {
  const store = useStore();
  const libs = useLibraries();
  const { layout } = useSettings();
  const mobile = layout === 'mobile';
  // 归档类型的库不在标签条里，但按 id 打开（如从它的资料页点「‹ 某某库」回来）照常显示这个库，不落到第一个库
  const requested = typeId ? store.get('task_type', typeId) : undefined;
  const type = libs.find((t) => t.id === typeId) ?? (requested && hasLibrary(requested) ? requested : undefined) ?? libs[0];
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState<string | null>(null);
  const [managing, setManaging] = useState(false);
  // 多选（合并用）：null = 不在选择模式
  const [selection, setSelection] = useState<string[] | null>(null);
  const [merging, setMerging] = useState<string[] | null>(null);
  const [dupes, setDupes] = useState(false);
  const entries = useMemo(() => (type ? store.libraryEntries(type.id) : []), [store, store.version, type?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // 资料库页按名字排；搜索时按匹配度
  const shown = useMemo(() => (query.trim() ? searchLibrary(entries, query, 500) : [...entries].sort((a, b) => b.recency - a.recency)), [entries, query]);
  const groups = useMemo(() => (type ? store.duplicateGroups(type.id) : []), [store, store.version, type?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!type) return null;
  const toggle = (id: string) => setSelection((s) => (s ?? []).includes(id) ? (s ?? []).filter((x) => x !== id) : [...(s ?? []), id]);
  const copy = libraryCopy(type);
  const person = isPersonLibrary(type);
  const shape = artShape(type);
  const Icon = typeIcon(type.icon);
  const open = (e: LibraryEntry) => navigate(e.kind === 'person' ? { page: 'person', id: e.id } : { page: 'libitem', typeId: type.id, id: e.id });
  const add = (name = '') => setAdding(name);

  return (
    <div className="page lib-page" style={{ '--chip-color': type.color } as CSSProperties}>
      <PageHeader
        title={tr('资料库')}
        {...(mobile ? {} : { subtitle: tr('看过的片、在读的书、想去的地方都留在这里，新建任务时直接选。') })}
        icon={<LibraryIcon size={22} />}
        {...(mobile
          ? {}
          : {
              actions: (
                <Button variant="primary" onPress={() => add(query.trim())}>
                  <Plus size={16} />
                  {tr('添加')}</Button>
              ),
            })}
      />
      <div className="lib-tabs-row">
      <nav className="lib-tabs" aria-label={tr('资料库')}>
        {libs.map((t) => (
          <LibTab key={t.id} type={t} active={t.id === type.id} onOpen={() => setQuery('')} />
        ))}
      </nav>
        <RacButton className="btn btn-quiet filter-edit lib-tabs-edit" aria-label={tr('编辑资料库')} onPress={() => setManaging(true)}>
          {tr('编辑')}</RacButton>
        {/* 这个库的 ··· 菜单（Rei 2026-10-26：在侧边栏显示 / 取消在侧边栏显示）；归档的库不给（侧边栏不显示归档的） */}
        {!isArchivedType(type) && <OverflowMenu label={tr('资料库操作')} items={[librarySidebarAction(store, type)]} className="lib-tabs-more" />}
      </div>
      <TypeManager isOpen={managing} onOpenChange={setManaging} />
      <div className="lib-toolbar">
        <SearchField aria-label={tr('在{name}里搜索', { name: copy.name })} className="lib-search" value={query} onChange={setQuery}>
          <Search size={15} className="lib-search-icon" aria-hidden />
          <Input className="input lib-search-input" placeholder={tr('在{name}里搜索', { name: copy.name })} />
          {query && (
            <RacButton className="icon-btn lib-search-clear" aria-label={tr('清除')}>
              <X size={14} />
            </RacButton>
          )}
        </SearchField>
        {selection ? (
          <div className="lib-select-bar">
            <span className="lib-select-count">{selection.length ? tr('已选 {n} 条', { n: selection.length }) : tr('选几条来合并')}</span>
            <Button variant="primary" isDisabled={selection.length < 2} onPress={() => setMerging(selection)}>
              <Merge size={15} />
              {tr('合并')}
            </Button>
            <Button variant="secondary" onPress={() => setSelection(null)}>
              {tr('完成')}
            </Button>
          </div>
        ) : (
          <>
            {groups.length > 0 && (
              <RacButton className="lib-dupes" onPress={() => setDupes(true)}>
                <Copy size={13} aria-hidden />
                {tr('可能重复 {n} 组', { n: groups.length })}
              </RacButton>
            )}
            <span className="lib-toolbar-count">
              {entries.length ? copy.count(entries.length) : ''}
              {/* 归档类型的库：标签条里没有它，这里轻轻标一下 */}
              {isArchivedType(type) && <>{entries.length ? ' · ' : ''}{tr('已归档')}</>}
            </span>
            {entries.length > 1 && (
              <RacButton className="lib-select-btn" onPress={() => setSelection([])}>
                {tr('选择')}
              </RacButton>
            )}
          </>
        )}
        {mobile && !selection && (
          <RacButton className="icon-btn lib-add-mobile" aria-label={tr('添加到{name}', { name: copy.name })} onPress={() => add(query.trim())}>
            <Plus size={20} />
          </RacButton>
        )}
      </div>

      {entries.length === 0 ? (
        <div className="lib-empty">
          <span className={`lib-empty-art art art-${shape}`}>
            <Icon size={26} />
          </span>
          <div className="lib-empty-title">{tr('{name}还是空的', { name: copy.name })}</div>
          <div className="lib-empty-hint">{tr('新建任务时选「{name}」，填过的会留在这里，下次直接选。', { name: dataLabel(type.name) })}</div>
          <Button variant="secondary" onPress={() => add()}>
            <Plus size={16} />
            {copy.addFirst}
          </Button>
        </div>
      ) : shown.length === 0 ? (
        <div className="lib-empty is-search">
          <div className="lib-empty-title">{tr('没有找到「{trim}」', { trim: query.trim() })}</div>
          <Button variant="secondary" onPress={() => add(query.trim())}>
            <Plus size={16} />
            {tr('新建“{trim}”', { trim: query.trim() })}</Button>
        </div>
      ) : (
        <div className={`lib-grid shape-${shape}`}>
          {shown.map((e) => (
            <Tile
              key={e.id}
              entry={e}
              type={type}
              onPress={() => open(e)}
              selected={selection ? selection.includes(e.id) : undefined}
              onSelect={() => (selection ? toggle(e.id) : setSelection([e.id]))}
            />
          ))}
        </div>
      )}

      {merging && (
        <MergeSheet
          store={store}
          type={type}
          ids={merging}
          onClose={() => setMerging(null)}
          onMerged={() => setSelection(null)}
        />
      )}
      {dupes && <DuplicatesSheet store={store} type={type} onClose={() => setDupes(false)} />}
      {!selection && <LibraryOnline type={type} query={query} />}
      {adding !== null &&
        (person ? (
          <PersonDialog initialName={adding} onClose={() => setAdding(null)} />
        ) : (
          <ItemSheet store={store} type={type} initialName={adding} onClose={() => setAdding(null)} onSaved={(id) => navigate({ page: 'libitem', typeId: type.id, id })} />
        ))}
    </div>
  );
}

export function LibraryItemPage({ typeId, id }: { typeId: string; id: string }) {
  const store = useStore();
  const ui = useUi();
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [mergeInto, setMergeInto] = useState(false);
  const item = store.get('library_item', id);
  const type = store.get('task_type', item?.type_id ?? typeId);
  if (!item || !type)
    return (
      <div className="page">
        <div className="lib-empty">
          <div className="lib-empty-title">{tr('这条资料不在了')}</div>
          <Button variant="secondary" onPress={() => navigate({ page: 'library', typeId })}>
            {tr('回到资料库')}</Button>
        </div>
      </div>
    );
  const copy = libraryCopy(type);
  const shape = artShape(type);
  const tasks = store.tasksOfItem(id);
  const open = tasks.filter((t) => !isFinished(t.status));
  const done = tasks.filter((t) => isFinished(t.status));
  const links = linkChips(type.fields, item.fields);
  const facts = factFieldsOf(type)
    .map((f) => ({ f, v: item.fields[f.key] }))
    .filter(({ v }) => fieldText(v).trim() !== '');
  return (
    <div className="page lib-item-page" style={{ '--chip-color': type.color } as CSSProperties}>
      <a className="back-link" href={href({ page: 'library', typeId: type.id })}>
        <ChevronLeft size={16} aria-hidden />
        {copy.name}
      </a>
      <header className={`lib-hero shape-${shape}`}>
        <ItemArt src={imageUrl(store, item.image)} name={item.name} shape={shape} className="lib-hero-art" />
        <div className="lib-hero-text">
          <div className="lib-hero-kicker">{dataLabel(type.name)}</div>
          <h1 className="page-title lib-hero-title">{item.name}</h1>
          {facts.length > 0 && (
            <dl className="lib-facts">
              {facts.map(({ f, v }) => (
                <div key={f.key} className="lib-fact">
                  <dt>{dataLabel(f.label)}</dt>
                  <dd>
                    {f.kind === 'link' && typeof v === 'string' ? (
                      <a href={v} target="_blank" rel="noreferrer" className="lib-link">
                        {v.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                        <ExternalLink size={12} aria-hidden />
                      </a>
                    ) : (
                      fieldDisplay(f, v)
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          <LinkChips links={links} className="lib-hero-links" />
          <SourceNote source={sourceOfFields(item.fields)} className="lib-hero-source" />
          <div className="lib-hero-actions">
            {/* 类型归档了：资料照常能看、能改，但不再用它新建任务 */}
            {!isArchivedType(type) && (
              <Button variant="primary" onPress={() => ui.openQuickCreate({ type_id: type.id, library_item_id: id })}>
                <Plus size={16} />
                {tr('用它新建任务')}</Button>
            )}
            <Button variant="secondary" onPress={() => setEditing(true)}>
              <Pencil size={15} />
              {tr('编辑资料')}</Button>
            <OverflowMenu
              items={[
                ...(store.libraryItems(type.id).length > 1 ? [{ id: 'merge', label: tr('合并到…'), icon: <Merge size={16} />, onAction: () => setMergeInto(true) }] : []),
                { id: 'delete', label: tr('删除…'), icon: <Trash2 size={16} />, danger: true, onAction: () => setConfirm(true) },
              ]}
            />
          </div>
        </div>
      </header>
      {item.note_md.trim() && <Markdown source={item.note_md} className="card note-card" />}
      <Section title={tr('相关任务 {length}', { length: tasks.length })}>
        {tasks.length ? (
          <div className="task-list plain">
            {[...open, ...done].map((t) => (
              <TaskRow key={t.id} store={store} task={t} showDate />
            ))}
          </div>
        ) : (
          <p className="lib-none">{tr('还没有任务用到它。')}</p>
        )}
      </Section>
      {editing && <ItemSheet store={store} type={type} itemId={id} onClose={() => setEditing(false)} />}
      {mergeInto && (
        <MergeIntoSheet
          store={store}
          type={type}
          sourceId={id}
          onClose={() => setMergeInto(false)}
          onMerged={(r) => r.targetId !== id && navigate({ page: 'libitem', typeId: type.id, id: r.targetId })}
        />
      )}
      <ConfirmDialog
        isOpen={confirm}
        onOpenChange={setConfirm}
        title={tr('删除这条资料？')}
        message={tasks.length ? <>{tr('用到「{name}」的 {length} 件任务会留着，只是不再和它连在一起。', { name: item.name, length: tasks.length })}</> : <>{tr('「{name}」会从{name2}里删除，删除后不能恢复。', { name: item.name, name2: copy.name })}</>}
        confirmLabel={tr('删除')}
        danger
        onConfirm={() => {
          store.deleteLibraryItem(id);
          navigate({ page: 'library', typeId: type.id });
          ui.toast({ message: tr('已删除') }, 2500);
        }}
      />
    </div>
  );
}
