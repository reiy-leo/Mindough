/**
 * 资料库：每个类型一个库（影视库、书库…、人物），按库切换；卡片网格（海报竖版 / 方形图标 / 横幅 / 圆形头像），
 * 搜索、添加；点开一条看它的资料和用到它的任务。文案见 docs/COPY.md「资料库」。
 */
import { useMemo, useState, type CSSProperties } from 'react';
import { Button as RacButton, Input, SearchField } from 'react-aria-components';
import { ChevronLeft, ExternalLink, Library as LibraryIcon, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import {
  BUILTIN_TYPE_IDS,
  factFieldsOf,
  linkChips,
  fieldDisplay,
  fieldText,
  hasLibrary,
  isFinished,
  isPersonLibrary,
  libraryCopy,
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
import { Button, ConfirmDialog, OverflowMenu, Section } from '../ui/primitives';
import { PageHeader } from '../components/PageHeader';
import { TaskRow } from '../components/TaskRow';
import { Markdown } from '../components/Markdown';
import { ItemArt, ItemSheet, artShape, entryArt } from '../components/library/Library';
import { SourceNote } from '../components/library/Lookup';
import { LinkChips } from '../components/library/LinkFields';
import { PersonDialog } from './People';
import { imageUrl } from '../lib/view';

import { dataLabel, tr } from '../lib/i18n';
function useLibraries(): TaskType[] {
  const store = useStore();
  return store
    .list('task_type')
    .filter((t) => !t.hidden && hasLibrary(t))
    .sort((a, b) => a.sort - b.sort);
}

function Tile({ entry, type, onPress }: { entry: LibraryEntry; type: TaskType; onPress: () => void }) {
  const store = useStore();
  const shape = artShape(type);
  return (
    <RacButton className={`lib-tile shape-${shape}`} onPress={onPress}>
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

export function LibraryPage({ typeId }: { typeId?: string }) {
  const store = useStore();
  const libs = useLibraries();
  const { layout } = useSettings();
  const mobile = layout === 'mobile';
  const type = libs.find((t) => t.id === typeId) ?? libs[0];
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState<string | null>(null);
  const entries = useMemo(() => (type ? store.libraryEntries(type.id) : []), [store, store.version, type?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // 资料库页按名字排；搜索时按匹配度
  const shown = useMemo(() => (query.trim() ? searchLibrary(entries, query, 500) : [...entries].sort((a, b) => b.recency - a.recency)), [entries, query]);
  if (!type) return null;
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
      <nav className="lib-tabs" aria-label={tr('资料库')}>
        {libs.map((t) => {
          const TIcon = typeIcon(t.icon);
          const active = t.id === type.id;
          const c = libraryCopy(t);
          const n = store.libraryEntries(t.id).length;
          return (
            <a
              key={t.id}
              href={href(t.id === BUILTIN_TYPE_IDS.person ? { page: 'people' } : { page: 'library', typeId: t.id })}
              className={`lib-tab${active ? ' is-active' : ''}`}
              aria-current={active ? 'page' : undefined}
              style={{ '--chip-color': t.color } as CSSProperties}
              onClick={() => setQuery('')}
            >
              <TIcon size={15} aria-hidden />
              <span>{c.short}</span>
              {n > 0 && <span className="lib-tab-count">{n}</span>}
            </a>
          );
        })}
      </nav>
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
        <span className="lib-toolbar-count">
          {entries.length ? copy.count(entries.length) : ''}
        </span>
        {mobile && (
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
            <Tile key={e.id} entry={e} type={type} onPress={() => open(e)} />
          ))}
        </div>
      )}

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
            <Button variant="primary" onPress={() => ui.openQuickCreate({ type_id: type.id, library_item_id: id })}>
              <Plus size={16} />
              {tr('用它新建任务')}</Button>
            <Button variant="secondary" onPress={() => setEditing(true)}>
              <Pencil size={15} />
              {tr('编辑资料')}</Button>
            <OverflowMenu items={[{ id: 'delete', label: tr('删除…'), icon: <Trash2 size={16} />, danger: true, onAction: () => setConfirm(true) }]} />
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
