/**
 * 资料库共用件：占位图 / 图片（ItemArt）、选择框（LibraryPicker）、资料编辑（ItemEditor）、
 * 选中的资料卡（ItemCard）、编辑资料弹层（ItemSheet）。文案见 docs/COPY.md「资料库」。
 */
import { useEffect, useId, useMemo, useRef, useState, type ClipboardEvent, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { Button as RacButton } from 'react-aria-components';
import { Check, ImagePlus, Plus, Search, Sparkles } from 'lucide-react';
import {
  extraItemFieldsOf,
  findLookupTwin,
  findSameName,
  isPersonLibrary,
  itemSubtitle,
  libraryCopy,
  linkChips,
  lookupKindOf,
  placeholderArt,
  searchLibrary,
  type FieldValue,
  type LibraryEntry,
  type LookupResult,
  type Store,
  type TaskType,
} from '@mindough/core';
import { imageUrl } from '../../lib/view';
import { saveImageAsset } from '../../lib/upload';
import { Button, Field, Sheet } from '../../ui/primitives';
import { FieldInput } from '../task/pickers';
import { LinkChips } from './LinkFields';
import { NoteField } from './NoteField';
import { AutofillPanel, OnlineOptions, SourceNote } from './Lookup';
import { useLookupAvailable, useOnlineSearch } from '../../lib/lookup';

import { dataLabel, tr } from '../../lib/i18n';
export { artShape, layoutShape, type ArtShape } from '../../lib/image';
import { artShape, type ArtShape } from '../../lib/image';

/** 资料的图：有图显示图，没有就是按名字生成的渐变 + 缩写。宽度由外层给，高度按形状比例。 */
export function ItemArt({ src, name, shape, className, style }: { src: string | null; name: string; shape: ArtShape; className?: string; style?: CSSProperties }) {
  const art = placeholderArt(name || '?');
  return (
    <span className={`art art-${shape}${src ? ' has-image' : ''}${className ? ` ${className}` : ''}`} style={{ '--art-from': art.from, '--art-to': art.to, ...style } as CSSProperties} aria-hidden>
      {src ? <img src={src} alt="" loading="lazy" draggable={false} /> : <span className="art-initials">{art.initials}</span>}
    </span>
  );
}

export function entryArt(store: Store, e: Pick<LibraryEntry, 'image' | 'name'>, shape: ArtShape, className?: string) {
  return <ItemArt src={imageUrl(store, e.image)} name={e.name} shape={shape} {...(className ? { className } : {})} />;
}

// ───────────── 选择框 ─────────────

/**
 * 在一个库里挑一条：边打字边搜（模糊、最近用到在前），带缩略图；最后一行「新建“xxx”」。
 * ↑↓ 移动，Enter 选中。
 */
export function LibraryPicker({
  store,
  type,
  query,
  onQueryChange,
  onPick,
  onCreate,
  autoFocus,
  exclude,
  className,
  searchText,
  allowCreate = true,
  onPickOnline,
  selected,
}: {
  store: Store;
  type: TaskType;
  query: string;
  onQueryChange: (q: string) => void;
  onPick: (e: LibraryEntry) => void;
  onCreate: (name: string) => void;
  /** 选中一条在线结果（TMDB / Open Library / Steam…）；不给就不在线找。 */
  onPickOnline?: (r: LookupResult) => void;
  autoFocus?: boolean;
  /** 不列出（详情里“换一个”时排除当前这条）。 */
  exclude?: string | null;
  className?: string;
  /** 实际拿去搜 / 新建的名字（如去掉了「S02E03」）；不给就用输入框里的字。 */
  searchText?: string;
  /** 最后一行「新建“xxx”」（合并时挑目标不要）。 */
  allowCreate?: boolean;
  /** 多选（任务的资料，Rei 2026-10-28）：已经挂上的，行尾打勾，再点一下去掉。 */
  selected?: ReadonlySet<string>;
}) {
  const copy = libraryCopy(type);
  const shape = artShape(type);
  const all = useMemo(() => store.libraryEntries(type.id).filter((e) => e.id !== exclude), [store, store.version, type.id, exclude]); // eslint-disable-line react-hooks/exhaustive-deps
  const q = (searchText ?? query).trim();
  const results = useMemo(() => searchLibrary(all, q, 40), [all, q]);
  const same = q ? findSameName(all, q) : undefined;
  const canCreate = allowCreate && !!q && !same;
  // 在线结果：在本地结果和「新建」下面；库里已有的同一条不再列出
  const kind = onPickOnline ? lookupKindOf(type) : null;
  // 在线找用输入框里的原文：季标记由在线搜索自己认（去掉、按剧集搜）
  const online = useOnlineSearch(kind, query);
  const onlineResults = useMemo(() => {
    const items = store.list('library_item');
    return online.results.filter((r) => !findLookupTwin(items, type.id, r));
  }, [online.results, store, store.version, type.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const onlineStart = results.length + (canCreate ? 1 : 0);
  const count = onlineStart + onlineResults.length;
  const [active, setActive] = useState(0);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    if (!autoFocus) return;
    const t = setTimeout(() => inputRef.current?.focus(), 40);
    return () => clearTimeout(t);
  }, [autoFocus]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const choose = (i: number) => {
    if (i < results.length) onPick(results[i]!);
    else if (i >= onlineStart) onPickOnline?.(onlineResults[i - onlineStart]!);
    else if (canCreate) onCreate(q);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => (count ? (a + 1) % count : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => (count ? (a - 1 + count) % count : 0));
    } else if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.nativeEvent.isComposing) {
      if (!count) return;
      e.preventDefault();
      choose(active);
    }
  };
  const optId = (i: number) => `${listId}-${i}`;
  const empty = all.length === 0;

  return (
    <div className={`lib-picker${className ? ` ${className}` : ''}`} style={{ '--chip-color': type.color } as CSSProperties}>
      <div className="lib-picker-field">
        <Search size={17} className="lib-picker-icon" aria-hidden />
        <input
          ref={inputRef}
          className="lib-picker-input"
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={count ? optId(active) : undefined}
          aria-label={copy.pick}
          placeholder={copy.pick}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={onKey}
          spellCheck={false}
          autoComplete="off"
        />
      </div>
      <ul ref={listRef} id={listId} role="listbox" aria-label={copy.name} className="lib-picker-list">
        {!q && !empty && (
          <li role="presentation" className="lib-picker-group">
            {tr('最近')}</li>
        )}
        {results.map((e, i) => (
          <li
            key={e.id}
            id={optId(i)}
            data-index={i}
            role="option"
            aria-selected={i === active}
            {...(selected ? { "aria-checked": selected.has(e.id) } : {})}
            className={`lib-option${i === active ? ' is-active' : ''}`}
            onMouseMove={() => setActive(i)}
            onMouseDown={(ev) => ev.preventDefault()}
            onClick={() => choose(i)}
          >
            {entryArt(store, e, shape, 'lib-option-art')}
            <span className="lib-option-text">
              <span className="lib-option-name">{e.name}</span>
              {e.subtitle && <span className="lib-option-sub">{e.subtitle}</span>}
            </span>
            {e.uses > 0 && <span className="lib-option-meta">{tr('{uses} 件任务', { uses: e.uses })}</span>}
            {selected && (
              <span className={`lib-option-check${selected.has(e.id) ? ' is-on' : ''}`} aria-hidden>
                {selected.has(e.id) && <Check size={12} strokeWidth={3} />}
              </span>
            )}
          </li>
        ))}
        {canCreate && (
          <li
            id={optId(results.length)}
            data-index={results.length}
            role="option"
            aria-selected={active === results.length}
            className={`lib-option lib-option-create${active === results.length ? ' is-active' : ''}`}
            onMouseMove={() => setActive(results.length)}
            onMouseDown={(ev) => ev.preventDefault()}
            onClick={() => choose(results.length)}
          >
            <span className={`lib-option-art lib-create-icon art art-${shape}`}>
              <Plus size={16} />
            </span>
            <span className="lib-option-text">
              <span className="lib-option-name">{tr('新建“{q}”', { q })}</span>
              <span className="lib-option-sub">{tr('加到{name}，下次直接选', { name: copy.name })}</span>
            </span>
          </li>
        )}
        {kind && q && (
          <OnlineOptions kind={kind} state={online} results={onlineResults} start={onlineStart} active={active} shape={shape} optId={optId} onHover={setActive} onChoose={choose} />
        )}
        {empty && !q && <li className="lib-picker-empty">{tr('{name}还是空的，输入名字就能新建。', { name: copy.name })}</li>}
        {!empty && q && results.length === 0 && !canCreate && <li className="lib-picker-empty">{tr('没有找到')}</li>}
      </ul>
    </div>
  );
}

// ───────────── 编辑资料 ─────────────

export interface ItemDraft {
  name: string;
  image: string | null;
  fields: Record<string, FieldValue>;
  note_md: string;
}

export const emptyDraft = (name = ''): ItemDraft => ({ name, image: null, fields: {}, note_md: '' });

export function draftOfEntry(store: Store, e: Pick<LibraryEntry, 'kind' | 'id'>): ItemDraft {
  if (e.kind === 'person') {
    const p = store.get('person', e.id);
    return { name: p?.name ?? '', image: p?.avatar_asset_id ?? null, fields: { relation: p?.relation ?? null }, note_md: p?.note_md ?? '' };
  }
  const it = store.get('library_item', e.id);
  return { name: it?.name ?? '', image: it?.image ?? null, fields: { ...(it?.fields ?? {}) }, note_md: it?.note_md ?? '' };
}

/** 先按形状统一宽高（lib/image.ts），登录在线时上传到 R2，否则存 data: 地址（lib/upload.ts）。 */
const saveImage = (store: Store, file: File, shape: ArtShape): Promise<string> => saveImageAsset(store, file, shape);

/** 图片：点一下上传，也能直接粘贴图片或图片链接。 */
function ArtUpload({ store, value, name, shape, label, onChange }: { store: Store; value: string | null; name: string; shape: ArtShape; label: string; onChange: (v: string | null) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const onPaste = async (e: ClipboardEvent) => {
    const f = [...e.clipboardData.files].find((x) => x.type.startsWith('image/'));
    if (f) {
      e.preventDefault();
      onChange(await saveImage(store, f, shape));
      return;
    }
    const text = e.clipboardData.getData('text').trim();
    if (/^https?:\/\/\S+$/.test(text)) {
      e.preventDefault();
      onChange(text);
    }
  };
  const url = imageUrl(store, value);
  return (
    <div className={`art-upload art-upload-${shape}`} onPaste={onPaste}>
      <RacButton className="art-upload-btn" aria-label={url ? tr('换{label}', { label }) : tr('添加{label}', { label })} onPress={() => fileRef.current?.click()}>
        <ItemArt src={url} name={name} shape={shape} />
        <span className="art-upload-hint">
          <ImagePlus size={15} />
          {url ? tr('换一张') : label}
        </span>
      </RacButton>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) onChange(await saveImage(store, f, shape));
          e.target.value = '';
        }}
      />
      {url && (
        <RacButton className="link-btn art-upload-clear" onPress={() => onChange(null)}>
          {tr('去掉图片')}</RacButton>
      )}
    </div>
  );
}

/** 一条资料的编辑：左边图片（上传 / 粘贴），右边名字和其余资料字段。 */
export function ItemEditor({ store, type, value, onChange, autoFocusName, showNote }: { store: Store; type: TaskType; value: ItemDraft; onChange: (d: ItemDraft) => void; autoFocusName?: boolean; showNote?: boolean }) {
  const person = isPersonLibrary(type);
  const shape = artShape(type);
  const primary = type.fields.find((f) => f.primary);
  const media = type.fields.find((f) => f.media && !f.primary);
  const extras = person ? [] : extraItemFieldsOf(type);
  const set = (p: Partial<ItemDraft>) => onChange({ ...value, ...p });
  const linkVal = typeof value.image === 'string' && /^https?:/.test(value.image) ? value.image : '';
  return (
    <div className={`item-editor shape-${shape}`} style={{ '--chip-color': type.color } as CSSProperties}>
      <ArtUpload store={store} value={value.image} name={value.name} shape={shape} label={person ? tr('头像') : (media ? dataLabel(media.label) : tr('图片'))} onChange={(v) => set({ image: v })} />
      <div className="item-editor-fields">
        <Field label={person ? tr('名字') : (primary ? dataLabel(primary.label) : tr('名称'))} value={value.name} onChange={(v) => set({ name: v })} autoFocus={!!autoFocusName} />
        {person ? (
          <Field label={tr('关系')} value={String(value.fields.relation ?? '')} onChange={(v) => set({ fields: { ...value.fields, relation: v || null } })} placeholder={tr('家人 / 朋友 / 同事')} />
        ) : (
          <>
            {extras.map((f) => (
              <div key={f.key} className={f.kind === 'list' || f.kind === 'link' || f.kind === 'links' || f.kind === 'multiselect' ? 'span-2' : undefined}>
                <FieldInput store={store} def={f} value={value.fields[f.key]} onChange={(v) => set({ fields: { ...value.fields, [f.key]: v } })} />
              </div>
            ))}
            {media && <Field className="span-2" label={tr('{label}链接', { label: media.label })} value={linkVal} onChange={(v) => set({ image: v.trim() || null })} placeholder={tr('可以直接粘贴图片链接')} />}
          </>
        )}
        {showNote && <NoteField className="span-2" value={value.note_md} onChange={(v) => set({ note_md: v })} />}
      </div>
    </div>
  );
}

/** 存下草稿：人物库 → person 表，其余 → library_item；返回条目 id。 */
export function saveDraft(store: Store, type: TaskType, d: ItemDraft, existingId?: string | null): string {
  const name = d.name.trim();
  if (isPersonLibrary(type)) {
    const data = { name, avatar_asset_id: d.image, relation: (d.fields.relation as string | null) || null, note_md: d.note_md };
    if (existingId) {
      store.update('person', existingId, data);
      return existingId;
    }
    return store.insert('person', { ...data, birthday: null }).id;
  }
  const fields = Object.fromEntries(Object.entries(d.fields).filter(([, v]) => v !== null && v !== '' && !(Array.isArray(v) && v.every((x) => !x))));
  if (existingId) {
    store.updateLibraryItem(existingId, { name, image: d.image, fields, note_md: d.note_md });
    return existingId;
  }
  return store.findOrCreateLibraryItem(type.id, { name, image: d.image, fields }).id;
}

/** 选中的资料：缩略图 + 名字 + 一行简介，右边放操作。 */
export function ItemCard({ store, type, entry, actions, size = 'md' }: { store: Store; type: TaskType; entry: Pick<LibraryEntry, 'name' | 'image' | 'subtitle' | 'links'> & Partial<Pick<LibraryEntry, 'source'>>; actions?: ReactNode; size?: 'md' | 'lg' }) {
  const shape = artShape(type);
  return (
    <div className={`item-card shape-${shape} size-${size}`} style={{ '--chip-color': type.color } as CSSProperties}>
      {entryArt(store, entry, shape, 'item-card-art')}
      <div className="item-card-text">
        <div className="item-card-name">{entry.name}</div>
        {entry.subtitle && <div className="item-card-sub">{entry.subtitle}</div>}
        {size === 'lg' && <LinkChips links={entry.links} className="item-card-links" />}
        {size === 'lg' && <SourceNote source={entry.source} className="item-card-source" />}
        {size === 'lg' && actions && <div className="item-card-actions">{actions}</div>}
      </div>
      {size !== 'lg' && actions && <div className="item-card-actions">{actions}</div>}
    </div>
  );
}

/** 草稿 → 卡片显示用的条目。 */
export function draftEntry(type: TaskType, d: ItemDraft) {
  return { name: d.name, image: d.image, subtitle: isPersonLibrary(type) ? String(d.fields.relation ?? '') : itemSubtitle(type, d.fields), links: isPersonLibrary(type) ? [] : linkChips(type.fields, d.fields) };
}

/**
 * 添加 / 编辑资料的弹层。uses > 1 时轻轻提一句：改动会同步到用到它的几件任务。
 */
export function ItemSheet({
  store,
  type,
  itemId,
  initialName,
  onClose,
  onSaved,
}: {
  store: Store;
  type: TaskType;
  /** 有 = 编辑；无 = 添加到库。 */
  itemId?: string | null;
  initialName?: string;
  onClose: () => void;
  onSaved?: (id: string) => void;
}) {
  const person = isPersonLibrary(type);
  const [d, setD] = useState<ItemDraft>(() => (itemId ? draftOfEntry(store, { kind: person ? 'person' : 'item', id: itemId }) : emptyDraft(initialName)));
  const copy = libraryCopy(type);
  const uses = itemId ? (person ? store.tasksOfPerson(itemId).length : store.tasksOfItem(itemId).length) : 0;
  const ok = d.name.trim() !== '';
  // 自动补全：影视 / 书 / 游戏，登录且在线时才有
  const lookupOn = useLookupAvailable();
  // 没登录 / 没网时按钮照样在，只是灰掉并说明原因（Rei 2026-10-28：不能一声不吐）
  const canLookup = !!lookupKindOf(type);
  const [filling, setFilling] = useState(false);
  const save = () => {
    if (!ok || filling) return;
    const id = saveDraft(store, type, d, itemId);
    onSaved?.(id);
    onClose();
  };
  return (
    <Sheet
      isOpen
      onOpenChange={(o) => !o && onClose()}
      title={itemId ? tr('编辑资料') : tr('添加到{name}', { name: copy.name })}
      className="modal-item"
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          save();
        }
      }}
      footer={
        filling ? undefined : (
        <>
          {canLookup && (
            <span title={lookupOn ? undefined : tr('登录后才能在线找，到设置里登录')}>
              <Button variant="quiet" className="item-autofill" isDisabled={!lookupOn} onPress={() => setFilling(true)}>
                <Sparkles size={15} aria-hidden />
                {tr('自动补全')}
              </Button>
            </span>
          )}
          {uses > 1 && <span className="foot-note">{tr('改动会同步到用到它的 {uses} 件任务', { uses })}</span>}
          <span className="grow" />
          <Button variant="secondary" onPress={onClose}>
            {tr('取消')}</Button>
          <Button variant="primary" isDisabled={!ok} onPress={save}>
            {itemId ? tr('保存') : tr('添加')}
          </Button>
        </>
        )
      }
    >
      {filling ? (
        <AutofillPanel
          store={store}
          type={type}
          draft={d}
          onCancel={() => setFilling(false)}
          onApply={(next) => {
            setD(next);
            setFilling(false);
          }}
        />
      ) : (
        <ItemEditor store={store} type={type} value={d} onChange={setD} autoFocusName showNote />
      )}
    </Sheet>
  );
}
