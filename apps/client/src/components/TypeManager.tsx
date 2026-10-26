/**
 * 类型编辑器（M4）：设置 →「类型」、资料库页标签条末尾「编辑」都打开它（同一个弹层）。
 * 第一屏是类型列表（拖动排序、归档、新建）；点进一个类型改名字、图标、颜色、资料库版式、默认完成方式、字段、正文模板。
 * 类型不能删，只能改和归档（Rei 2026-10-17）：归档的不在主列表里，列表最底下一行「已归档 N 个」点开可取消归档。
 * 纯逻辑在 core 的 typedef.ts 与 Store（updateType / setTypeFields / addTypeField / archiveType / unarchiveType…）。
 * 「普通」「人物」不在这里出现（人物类型已删，人物库保留）。文案见 docs/COPY.md「类型编辑器」。
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { GridList, GridListItem, Input, TextField, useDragAndDrop, Button as RacButton } from 'react-aria-components';
import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  Banknote,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Eye,
  EyeOff,
  Fingerprint,
  Gauge,
  GripVertical,
  Hash,
  Image as ImageIcon,
  Link,
  Link2,
  ListChecks,
  Lock,
  Plus,
  Settings2,
  SquareCheck,
  Trash2,
  Tv,
  Type as TypeGlyph,
  UserRound,
  X,
  type LucideIcon,
} from 'lucide-react';
import {
  COMPLETION_MODES,
  COMPLETION_MODE_LABEL,
  EDITABLE_FIELD_KINDS,
  FIELD_KIND_LABEL,
  LIBRARY_LAYOUTS,
  SITES,
  TYPE_LAYOUT_LABEL,
  isArchivedType,
  isFixedField,
  liveFields,
  moveField,
  removeField,
  reorderFields,
  updateField,
  type CompletionMode,
  type FieldDef,
  type FieldKind,
  type TaskType,
  type TypeLayout,
} from '@mindough/core';
import { PICKER_ICONS, isEmojiIcon, typeIcon } from '../lib/icons';
import { AutoTextarea, Button, ConfirmDialog, IconButton, PopoverPanel, Section, Segmented, Select, Sheet } from '../ui/primitives';
import { useStore } from '../store/StoreProvider';
import { useSettings } from '../lib/settings';
import { useUi } from '../lib/ui';
import { isDragPress, useReorderGuard } from '../lib/drag-guard';
import { layoutShape } from './library/Library';

import { dataLabel, tr, trc } from '../lib/i18n';

const KIND_ICON: Record<FieldKind, LucideIcon> = {
  text: TypeGlyph,
  number: Hash,
  progress: Gauge,
  date: CalendarDays,
  link: Link,
  image: ImageIcon,
  select: CircleDot,
  multiselect: SquareCheck,
  money: Banknote,
  episode: Tv,
  person: UserRound,
  list: ListChecks,
  site_id: Fingerprint,
  links: Link2,
};

/** 颜色色板（Apple 系统色的亮色版，明暗都看得清）。 */
const SWATCHES = ['#ff3b30', '#ff6b5b', '#ff9f0a', '#ffcc00', '#c58b3d', '#34c759', '#00a6a6', '#0a84ff', '#2f80ed', '#5e5ce6', '#7c5cff', '#af52de', '#ff2d55', '#8e8e93'];

export function TypeManager({ isOpen, onOpenChange, initialTypeId }: { isOpen: boolean; onOpenChange: (open: boolean) => void; initialTypeId?: string | null }) {
  const store = useStore();
  const [editing, setEditing] = useState<string | null>(initialTypeId ?? null);
  useEffect(() => {
    if (isOpen) setEditing(initialTypeId ?? null);
  }, [isOpen, initialTypeId]);
  const type = editing ? store.get('task_type', editing) : undefined;
  const done = (
    <Button variant="primary" onPress={() => onOpenChange(false)}>
      {tr('完成')}
    </Button>
  );
  return (
    <Sheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title={type ? dataLabel(type.name) || trc('资料库编辑器', '资料库') : trc('资料库编辑器', '资料库')}
      className="modal-types"
      {...(type
        ? {
            headerStart: (
              <RacButton className="btn btn-quiet type-back" onPress={() => setEditing(null)}>
                <ChevronLeft size={18} />
                {trc('资料库编辑器', '资料库')}
              </RacButton>
            ),
          }
        : {})}
      footer={
        type ? (
          <>
            <span className="grow" />
            {done}
          </>
        ) : (
          <>
            <span className="foot-note">{tr('排在前面的，新建任务时也排在前面。')}</span>
            <span className="grow" />
            <Button
              variant="secondary"
              onPress={() => {
                const t = store.createType({ name: tr('新资料库') });
                setEditing(t.id);
              }}
            >
              <Plus size={15} />
              {tr('新建资料库')}
            </Button>
            {done}
          </>
        )
      }
    >
      {type ? <TypeEditor key={type.id} type={type} onArchived={() => setEditing(null)} /> : <TypeList onOpen={setEditing} />}
    </Sheet>
  );
}

// ───────────── 类型列表 ─────────────

/** 归档一个类型：提示里可撤销。 */
function useArchive() {
  const store = useStore();
  const ui = useUi();
  return (t: TaskType) => {
    store.archiveType(t.id);
    ui.toast({
      message: tr('已归档「{name}」', { name: dataLabel(t.name) }),
      actions: [{ label: tr('撤销'), onPress: () => store.unarchiveType(t.id) }],
    });
  };
}

function usageText(u: { tasks: number; items: number }): string {
  return [u.tasks ? tr('{n} 件任务', { n: u.tasks }) : '', u.items ? tr('资料 {n} 条', { n: u.items }) : ''].filter(Boolean).join(' · ');
}

function TypeList({ onOpen }: { onOpen: (id: string) => void }) {
  const store = useStore();
  const types = store.editableTypes();
  const archived = store.archivedTypes();
  const [showArchived, setShowArchived] = useState(false);
  const archive = useArchive();
  const reorderGuard = useReorderGuard();
  const { dragAndDropHooks } = useDragAndDrop({
    ...reorderGuard.handlers,
    getItems: (keys) => [...keys].map((k) => ({ 'text/plain': String(k) })),
    onReorder: (e) => {
      const order = types.map((t) => t.id);
      const moving = [...e.keys].map(String);
      const rest = order.filter((id) => !moving.includes(id));
      const at = rest.indexOf(String(e.target.key));
      rest.splice(e.target.dropPosition === 'before' ? at : at + 1, 0, ...moving);
      store.reorderTypes(rest);
    },
  });
  return (
    <>
      <GridList ref={reorderGuard.ref} aria-label={trc('资料库编辑器', '资料库')} className="type-manage-list" items={types} dragAndDropHooks={dragAndDropHooks} onAction={(k) => !isDragPress() && onOpen(String(k))}>
        {(t) => {
          const Icon = typeIcon(t.icon);
          const name = dataLabel(t.name);
          return (
            <GridListItem id={t.id} textValue={name} className="type-row">
              <RacButton slot="drag" className="drag-handle" aria-label={tr('拖动排序')}>
                <GripVertical size={14} />
              </RacButton>
              <span className="type-row-icon" style={{ '--chip-color': t.color } as CSSProperties} aria-hidden>
                <Icon size={16} />
              </span>
              <span className="type-row-text">
                <span className="type-row-name">{name}</span>
                <span className="type-row-sub">{usageText(store.typeUsage(t.id)) || (t.builtin ? tr('内置') : tr('自定义'))}</span>
              </span>
              <IconButton label={tr('归档「{name}」', { name })} onPress={() => archive(t)}>
                <Archive size={16} />
              </IconButton>
              <ChevronRight size={16} className="type-row-chevron" aria-hidden />
            </GridListItem>
          );
        }}
      </GridList>
      {archived.length > 0 && (
        <div className="type-archived">
          <RacButton className="type-archived-toggle" aria-expanded={showArchived} onPress={() => setShowArchived((v) => !v)}>
            <Archive size={13} aria-hidden />
            {tr('已归档 {n} 个', { n: archived.length })}
            <ChevronRight size={13} className={`type-archived-chevron${showArchived ? ' is-open' : ''}`} aria-hidden />
          </RacButton>
          {showArchived && (
            <ul className="type-archived-list" aria-label={tr('已归档的资料库')}>
              {archived.map((t) => {
                const Icon = typeIcon(t.icon);
                const name = dataLabel(t.name);
                return (
                  <li key={t.id} className="type-row is-archived">
                    <span className="type-row-icon" style={{ '--chip-color': t.color } as CSSProperties} aria-hidden>
                      <Icon size={16} />
                    </span>
                    <span className="type-row-text">
                      <span className="type-row-name">{name}</span>
                      <span className="type-row-sub">{usageText(store.typeUsage(t.id)) || (t.builtin ? tr('内置') : tr('自定义'))}</span>
                    </span>
                    <Button variant="secondary" onPress={() => store.unarchiveType(t.id)}>
                      <ArchiveRestore size={15} />
                      {tr('取消归档')}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </>
  );
}

// ───────────── 一个类型 ─────────────

/** 失焦才保存的文字框：内置名字没改动不写回（存的仍是中文原名）。 */
function useCommitted(stored: string, save: (v: string) => void) {
  const shown = dataLabel(stored);
  const [v, setV] = useState(shown);
  useEffect(() => setV(shown), [shown]);
  const commit = () => {
    const n = v.trim();
    if (!n) setV(shown);
    else if (n !== shown && n !== stored) save(n);
  };
  return { value: v, setValue: setV, commit };
}

function TypeEditor({ type, onArchived }: { type: TaskType; onArchived: () => void }) {
  const store = useStore();
  const archive = useArchive();
  const { layout } = useSettings();
  const name = useCommitted(type.name, (n) => store.updateType(type.id, { name: n }));
  const tpl = useCommitted(type.body_template, (n) => store.updateType(type.id, { body_template: n }));
  const archived = isArchivedType(type);
  const Icon = typeIcon(type.icon);
  return (
    <div className="type-editor" style={{ '--chip-color': type.color } as CSSProperties}>
      <div className="type-head">
        <PopoverPanel
          label={tr('图标')}
          className="icon-pick-popover"
          trigger={
            <RacButton className="type-icon-btn" aria-label={tr('换图标')}>
              <Icon size={26} />
            </RacButton>
          }
        >
          {(close) => (
            <IconPicker
              value={type.icon}
              onChange={(icon) => {
                store.updateType(type.id, { icon });
                close();
              }}
            />
          )}
        </PopoverPanel>
        <TextField aria-label={tr('资料库名字')} value={name.value} onChange={name.setValue} className="type-name-field">
          <Input className="input type-name-input" placeholder={tr('资料库名字')} onBlur={name.commit} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
        </TextField>
      </div>

      <div className="type-props">
        <PropLine label={tr('颜色')}>
          <ColorPicker value={type.color} onChange={(color) => store.updateType(type.id, { color })} />
        </PropLine>
        <PropLine label={tr('资料库版式')} hint={tr('资料库和卡片上图片的形状')}>
          <LayoutPicker value={type.layout} onChange={(l) => store.updateType(type.id, { layout: l })} />
        </PropLine>
        <PropLine label={tr('默认怎么算完成')}>
          {layout === 'mobile' ? (
            <Select
              label={tr('默认怎么算完成')}
              className="type-mode-select"
              value={type.default_completion_mode}
              onChange={(v) => store.updateType(type.id, { default_completion_mode: v as CompletionMode })}
              options={COMPLETION_MODES.map((m) => ({ id: m, label: COMPLETION_MODE_LABEL[m] }))}
            />
          ) : (
            <Segmented<CompletionMode>
              label={tr('默认怎么算完成')}
              value={type.default_completion_mode}
              onChange={(v) => store.updateType(type.id, { default_completion_mode: v })}
              options={COMPLETION_MODES.map((m) => ({ id: m, label: COMPLETION_MODE_LABEL[m] }))}
            />
          )}
        </PropLine>
      </div>

      <Section title={tr('字段')} className="type-section">
        <p className="type-hint">{tr('资料字段属于这部片、这本书本身，几件任务共用；任务字段只属于这一次，比如看到第几集。')}</p>
        <FieldList type={type} />
      </Section>

      <Section title={tr('新建时的正文')} className="type-section">
        <div className="type-template">
          <AutoTextarea label={tr('新建时的正文')} value={tpl.value} onChange={tpl.setValue} onBlur={tpl.commit} placeholder={tr('比如：## 想看理由')} minRows={3} />
        </div>
      </Section>

      <div className="type-danger">
        <span className="foot-note">
          {archived ? tr('已归档：新建任务时选不到它，用过它的任务和资料照常显示。') : tr('资料库不能删。不再用了就归档：新建任务时选不到它，用过它的任务和资料照常显示。')}
        </span>
        <span className="grow" />
        {archived ? (
          <Button variant="secondary" onPress={() => store.unarchiveType(type.id)}>
            <ArchiveRestore size={15} />
            {tr('取消归档')}
          </Button>
        ) : (
          <Button
            variant="secondary"
            onPress={() => {
              archive(type);
              onArchived();
            }}
          >
            <Archive size={15} />
            {tr('归档这个资料库')}
          </Button>
        )}
      </div>
    </div>
  );
}

function PropLine({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="type-prop">
      <div className="type-prop-label">
        <span>{label}</span>
        {hint && <span className="type-prop-hint">{hint}</span>}
      </div>
      <div className="type-prop-value">{children}</div>
    </div>
  );
}

/** 图标选择：lucide 图标网格 + 自己填一个 emoji。 */
export function IconPicker({ value, onChange }: { value: string; onChange: (icon: string) => void }) {
  const [emoji, setEmoji] = useState(isEmojiIcon(value) ? value : '');
  const submitEmoji = () => {
    const e = [...emoji.trim()].slice(0, 2).join('');
    if (e && isEmojiIcon(e)) onChange(e);
  };
  return (
    <div className="icon-picker">
      <div className="icon-grid" role="listbox" aria-label={tr('图标')}>
        {PICKER_ICONS.map((n) => {
          const I = typeIcon(n);
          return (
            <RacButton key={n} className={`icon-cell${value === n ? ' is-selected' : ''}`} aria-label={n} onPress={() => onChange(n)}>
              <I size={18} />
            </RacButton>
          );
        })}
      </div>
      <div className="icon-emoji-row">
        <TextField aria-label={tr('或者用一个 emoji')} value={emoji} onChange={setEmoji} className="icon-emoji-field">
          <Input className="input" placeholder={tr('或者用一个 emoji，如 🎙️')} onKeyDown={(e) => e.key === 'Enter' && submitEmoji()} />
        </TextField>
        <Button variant="secondary" isDisabled={!isEmojiIcon(emoji.trim())} onPress={submitEmoji}>
          {tr('用这个')}
        </Button>
      </div>
    </div>
  );
}

export function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  const custom = !SWATCHES.includes(value.toLowerCase());
  return (
    <div className="swatches" role="radiogroup" aria-label={tr('颜色')}>
      {SWATCHES.map((c) => (
        <RacButton key={c} className={`swatch${value.toLowerCase() === c ? ' is-selected' : ''}`} style={{ '--swatch': c } as CSSProperties} aria-label={c} onPress={() => onChange(c)} />
      ))}
      <label className={`swatch swatch-custom${custom ? ' is-selected' : ''}`} style={{ '--swatch': value } as CSSProperties} title={tr('自己调')}>
        <input type="color" aria-label={tr('自己调颜色')} value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#5e5ce6'} onChange={(e) => onChange(e.target.value)} />
      </label>
    </div>
  );
}

function LayoutPicker({ value, onChange }: { value: TypeLayout; onChange: (l: TypeLayout) => void }) {
  const ratio: Record<string, string> = { poster: '2:3', icon_name: '1:1', banner: '16:9', round: '' };
  return (
    <div className="layout-pick" role="radiogroup" aria-label={tr('资料库版式')}>
      {LIBRARY_LAYOUTS.map((l) => (
        <RacButton key={l} className={`layout-opt${value === l ? ' is-selected' : ''}`} aria-label={TYPE_LAYOUT_LABEL[l]} onPress={() => onChange(l)}>
          <span className={`layout-shape shape-${layoutShape(l)}`} aria-hidden />
          <span className="layout-opt-label">{TYPE_LAYOUT_LABEL[l]}</span>
          {ratio[l] && <span className="layout-opt-ratio">{ratio[l]}</span>}
        </RacButton>
      ))}
    </div>
  );
}

// ───────────── 字段 ─────────────

function FieldList({ type }: { type: TaskType }) {
  const store = useStore();
  const fields = liveFields(type);
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<FieldKind>('text');
  const reorderGuard = useReorderGuard();
  const { dragAndDropHooks } = useDragAndDrop({
    ...reorderGuard.handlers,
    getItems: (keys) => [...keys].map((k) => ({ 'text/plain': String(k) })),
    onReorder: (e) => {
      const order = fields.map((f) => f.key);
      const moving = [...e.keys].map(String);
      const rest = order.filter((k) => !moving.includes(k));
      const at = rest.indexOf(String(e.target.key));
      rest.splice(e.target.dropPosition === 'before' ? at : at + 1, 0, ...moving);
      store.setTypeFields(type.id, reorderFields(type.fields, rest));
    },
  });
  const add = () => {
    const l = label.trim();
    if (!l) return;
    store.addTypeField(type.id, { label: l, kind, ...(kind === 'select' || kind === 'multiselect' ? { options: [] } : {}) });
    setLabel('');
  };
  return (
    <div className="field-manage">
      <GridList ref={reorderGuard.ref} aria-label={tr('字段')} className="field-manage-list" items={fields.map((f) => ({ ...f, id: f.key }))} dragAndDropHooks={dragAndDropHooks}>
        {(f) => (
          <GridListItem id={f.key} textValue={dataLabel(f.label)} className={`field-row${f.hidden ? ' is-hidden' : ''}`}>
            <FieldRow type={type} f={f} index={fields.findIndex((x) => x.key === f.key)} count={fields.length} />
          </GridListItem>
        )}
      </GridList>
      <div className="field-row field-row-add">
        <Plus size={16} className="field-row-kind" aria-hidden />
        <TextField aria-label={tr('新字段的名字')} value={label} onChange={setLabel} className="field-row-name">
          <Input className="input" placeholder={tr('新字段')} onKeyDown={(e) => e.key === 'Enter' && add()} />
        </TextField>
        <Select
          label={tr('种类')}
          className="field-kind-select"
          value={kind}
          onChange={(v) => setKind(v as FieldKind)}
          options={EDITABLE_FIELD_KINDS.map((k) => ({ id: k, label: FIELD_KIND_LABEL[k] }))}
        />
        <Button variant="secondary" onPress={add} isDisabled={!label.trim()}>
          {tr('添加')}
        </Button>
      </div>
    </div>
  );
}

function FieldRow({ type, f, index, count }: { type: TaskType; f: FieldDef; index: number; count: number }) {
  const store = useStore();
  const name = useCommitted(f.label, (n) => store.setTypeFields(type.id, updateField(type.fields, f.key, { label: n })));
  const KIcon = KIND_ICON[f.kind];
  const fixed = isFixedField(f);
  const shown = dataLabel(f.label);
  return (
    <>
      <RacButton slot="drag" className="drag-handle" aria-label={tr('拖动排序')}>
        <GripVertical size={14} />
      </RacButton>
      <KIcon size={16} className="field-row-kind" aria-hidden />
      <TextField aria-label={tr('「{name}」的名字', { name: shown })} value={name.value} onChange={name.setValue} className="field-row-name">
        <Input className="input" onBlur={name.commit} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
      </TextField>
      <span className="field-row-meta">
        {FIELD_KIND_LABEL[f.kind] !== shown && FIELD_KIND_LABEL[f.kind]}
        <span className={`field-scope${f.scope === 'task' && !fixed ? ' is-task' : ''}`}>{f.scope === 'task' && !fixed ? trc('字段归属', '任务') : trc('字段归属', '资料')}</span>
      </span>
      {fixed ? (
        <span className="field-row-lock" title={tr('名字和图片是固定的，不能隐藏或删除')}>
          <Lock size={14} aria-label={tr('固定字段')} />
        </span>
      ) : (
        <IconButton label={f.hidden ? tr('显示「{name}」', { name: shown }) : tr('隐藏「{name}」', { name: shown })} onPress={() => store.setTypeFields(type.id, updateField(type.fields, f.key, { hidden: !f.hidden }))}>
          {f.hidden ? <EyeOff size={16} /> : <Eye size={16} />}
        </IconButton>
      )}
      <PopoverPanel
        label={tr('「{name}」的设置', { name: shown })}
        placement="bottom end"
        className="field-settings-popover"
        trigger={
          <RacButton className="icon-btn" aria-label={tr('「{name}」的设置', { name: shown })}>
            <Settings2 size={16} />
          </RacButton>
        }
      >
        {(close) => <FieldSettings type={type} f={f} index={index} count={count} close={close} />}
      </PopoverPanel>
    </>
  );
}

function FieldSettings({ type, f, index, count, close }: { type: TaskType; f: FieldDef; index: number; count: number; close: () => void }) {
  const store = useStore();
  const fixed = isFixedField(f);
  const hasData = store.fieldHasData(type.id, f.key);
  const set = (patch: Parameters<typeof updateField>[2]) => store.setTypeFields(type.id, updateField(store.get('task_type', type.id)!.fields, f.key, patch));
  const [unit, setUnit] = useState(dataLabel(f.unit ?? ''));
  const [placeholder, setPlaceholder] = useState(dataLabel(f.placeholder ?? ''));
  return (
    <div className="field-settings">
      {!fixed && (
        <>
          <Select
            label={tr('种类')}
            value={f.kind}
            onChange={(v) => set({ kind: v as FieldKind })}
            options={(EDITABLE_FIELD_KINDS.includes(f.kind) ? EDITABLE_FIELD_KINDS : [...EDITABLE_FIELD_KINDS, f.kind]).map((k) => ({ id: k, label: FIELD_KIND_LABEL[k] }))}
            {...(hasData ? { isDisabled: true } : {})}
          />
          {hasData && <p className="field-settings-hint">{tr('已经填过值，种类和归属不能再改；要换就新加一个字段。')}</p>}
          <div className="field-settings-row">
            <span className="field-label">{tr('属于')}</span>
            {hasData ? (
              <span className="field-settings-static">{f.scope === 'task' ? tr('任务字段') : tr('资料字段')}</span>
            ) : (
              <Segmented<'item' | 'task'>
                label={tr('属于')}
                value={f.scope === 'task' ? 'task' : 'item'}
                onChange={(v) => set({ scope: v })}
                options={[
                  { id: 'item', label: tr('资料字段') },
                  { id: 'task', label: tr('任务字段') },
                ]}
              />
            )}
          </div>
        </>
      )}
      {(f.kind === 'select' || f.kind === 'multiselect') && <OptionsEditor type={type} f={f} />}
      {(f.kind === 'number' || f.kind === 'progress') && (
        <TextField aria-label={tr('单位')} value={unit} onChange={setUnit} className="field">
          <span className="field-label">{tr('单位')}</span>
          <Input className="input" placeholder={tr('页、集、%')} onBlur={() => unit !== dataLabel(f.unit ?? '') && set({ unit: unit.trim() || undefined })} />
        </TextField>
      )}
      {f.kind === 'site_id' && (
        <Select label={tr('哪个网站')} value={f.site ?? 'imdb'} onChange={(v) => set({ site: v })} options={Object.entries(SITES).map(([id, s]) => ({ id, label: s.label }))} />
      )}
      {(f.kind === 'text' || f.kind === 'number' || f.kind === 'link' || f.kind === 'episode' || f.kind === 'progress') && (
        <TextField aria-label={tr('提示文字')} value={placeholder} onChange={setPlaceholder} className="field">
          <span className="field-label">{tr('提示文字')}</span>
          <Input className="input" placeholder={tr('空着时显示的灰字')} onBlur={() => placeholder !== dataLabel(f.placeholder ?? '') && set({ placeholder: placeholder.trim() || undefined })} />
        </TextField>
      )}
      <div className="field-settings-actions">
        <IconButton label={tr('上移')} isDisabled={index <= 0} onPress={() => store.setTypeFields(type.id, moveField(store.get('task_type', type.id)!.fields, f.key, -1))}>
          <ArrowUp size={16} />
        </IconButton>
        <IconButton label={tr('下移')} isDisabled={index >= count - 1} onPress={() => store.setTypeFields(type.id, moveField(store.get('task_type', type.id)!.fields, f.key, 1))}>
          <ArrowDown size={16} />
        </IconButton>
        <span className="grow" />
        {!fixed && (
          <Button
            variant="danger"
            onPress={() => {
              store.setTypeFields(type.id, removeField(store.get('task_type', type.id)!.fields, f.key));
              close();
            }}
          >
            <Trash2 size={15} />
            {tr('删除字段')}
          </Button>
        )}
      </div>
      {!fixed && <p className="field-settings-hint">{tr('删掉后已填的值还留着，加回同名字段就又能看到。')}</p>}
    </div>
  );
}

function OptionsEditor({ type, f }: { type: TaskType; f: FieldDef }) {
  const store = useStore();
  const [draft, setDraft] = useState('');
  const opts = f.options ?? [];
  const setOptions = (options: string[]) => store.setTypeFields(type.id, updateField(store.get('task_type', type.id)!.fields, f.key, { options }));
  const add = () => {
    const o = draft.trim();
    if (!o) return;
    setOptions([...opts, o]);
    setDraft('');
  };
  return (
    <div className="options-editor">
      <span className="field-label">{tr('选项')}</span>
      <ul className="options-list">
        {opts.map((o) => (
          <OptionRow key={o} value={o} onRename={(to) => store.renameFieldOption(type.id, f.key, o, to)} onRemove={() => setOptions(opts.filter((x) => x !== o))} />
        ))}
        <li className="option-row">
          <TextField aria-label={tr('新选项')} value={draft} onChange={setDraft} className="option-name">
            <Input className="input" placeholder={tr('加一个选项')} onKeyDown={(e) => e.key === 'Enter' && add()} onBlur={add} />
          </TextField>
        </li>
      </ul>
    </div>
  );
}

function OptionRow({ value, onRename, onRemove }: { value: string; onRename: (to: string) => void; onRemove: () => void }) {
  const c = useCommitted(value, onRename);
  return (
    <li className="option-row">
      <TextField aria-label={tr('选项「{name}」', { name: dataLabel(value) })} value={c.value} onChange={c.setValue} className="option-name">
        <Input className="input" onBlur={c.commit} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
      </TextField>
      <IconButton label={tr('去掉「{name}」', { name: dataLabel(value) })} onPress={onRemove}>
        <X size={14} />
      </IconButton>
    </li>
  );
}
