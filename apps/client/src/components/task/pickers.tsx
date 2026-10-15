/**
 * 新建面板与任务详情共用的属性编辑件。文案规则见 docs/COPY.md。
 */
import type { CSSProperties, ReactNode } from 'react';
import {
  Button as RacButton,
  ListBox,
  ListBoxItem,
  Popover,
  Radio,
  RadioGroup,
  Select as RacSelect,
  SelectValue,
  ToggleButton,
  ToggleButtonGroup,
} from 'react-aria-components';
import { CalendarClock, Check, ChevronDown, CircleCheck, Hash, ImagePlus, Timer } from 'lucide-react';
import {
  COMPLETION_MODES,
  COMPLETION_MODE_HINT,
  COMPLETION_MODE_LABEL,
  DURATION_UNIT_LABEL,
  countdownPhrase,
  durationMs,
  durationParts,
  formatRecurrence,
  friendlyDate,
  parseRecurrence,
  weekday,
  type CompletionMode,
  type DateKey,
  type DurationUnit,
  type FieldDef,
  type FieldValue,
  type Recurrence,
  type Store,
  type Task,
  type TaskType,
} from '@mindough/core';
import { Field, InlineNumber, InlineText, PopoverPanel, Select } from '../../ui/primitives';
import { DatePanel } from './DatePanel';
import { Avatar } from '../Avatar';
import { typeIcon } from '../../lib/icons';
import { imageUrl } from '../../lib/view';

export const MODE_ICON: Record<CompletionMode, typeof Timer> = { once: CircleCheck, timer: Timer, count: Hash, countdown: CalendarClock };

/** 完成方式的选择：四张卡片（单选，方向键可切换）。 */
export function CompletionChoice({ value, onChange, compact }: { value: CompletionMode; onChange: (m: CompletionMode) => void; compact?: boolean }) {
  return (
    <RadioGroup aria-label="怎么算完成" className={`mode-choice${compact ? ' is-compact' : ''}`} value={value} onChange={(v) => onChange(v as CompletionMode)}>
      {COMPLETION_MODES.map((m) => {
        const Icon = MODE_ICON[m];
        return (
          <Radio key={m} value={m} className="mode-card">
            <span className="mode-icon" aria-hidden>
              <Icon size={18} />
            </span>
            <span className="mode-text">
              <span className="mode-label">{COMPLETION_MODE_LABEL[m]}</span>
              <span className="mode-hint">{COMPLETION_MODE_HINT[m]}</span>
            </span>
            <span className="mode-check" aria-hidden>
              <Check size={12} strokeWidth={3} />
            </span>
          </Radio>
        );
      })}
    </RadioGroup>
  );
}

export type CompletionValue = Pick<Task, 'completion_mode' | 'target_value' | 'unit' | 'target_date'>;

function InlineSelect<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: Array<{ id: T; label: string }> }) {
  return (
    <RacSelect aria-label={label} className="inline-field" selectedKey={value} onSelectionChange={(k) => k !== null && onChange(String(k) as T)}>
      <RacButton className="input inline-input inline-select">
        <SelectValue />
        <ChevronDown size={14} aria-hidden />
      </RacButton>
      <Popover className="popover">
        <ListBox className="listbox" items={options}>
          {(o) => (
            <ListBoxItem id={o.id} className="listbox-item" textValue={o.label}>
              {o.label}
            </ListBoxItem>
          )}
        </ListBox>
      </Popover>
    </RacSelect>
  );
}

/** 选中某种完成方式后，只显示它自己的设置，写成一句话。 */
export function CompletionSentence({ value, onChange, today }: { value: CompletionValue; onChange: (p: Partial<CompletionValue>) => void; today: DateKey }) {
  switch (value.completion_mode) {
    case 'once':
      return null;
    case 'timer': {
      const parts = durationParts(value.target_value) ?? { value: 10, unit: 'min' as DurationUnit };
      return (
        <div className="sentence">
          <span>每次</span>
          <InlineNumber label="时长" value={parts.value} onChange={(v) => onChange({ target_value: durationMs(v, parts.unit) })} width={3} />
          <InlineSelect<DurationUnit>
            label="时长单位"
            value={parts.unit}
            onChange={(u) => onChange({ target_value: durationMs(parts.value, u) })}
            options={(Object.keys(DURATION_UNIT_LABEL) as DurationUnit[]).map((u) => ({ id: u, label: DURATION_UNIT_LABEL[u] }))}
          />
          <span className="sentence-note">够了就算完成</span>
        </div>
      );
    }
    case 'count':
      return (
        <div className="sentence">
          <span>目标</span>
          <InlineNumber label="目标数量" value={value.target_value ?? 1} onChange={(v) => onChange({ target_value: Math.max(1, v) })} width={3} />
          <InlineText label="单位" value={value.unit ?? ''} onChange={(u) => onChange({ unit: u.trim() ? u : null })} placeholder="次" width={3} />
          <span className="sentence-note">每次 +1，加够就算完成</span>
        </div>
      );
    case 'countdown':
      return (
        <div className="sentence">
          <span>目标日期</span>
          <PopoverPanel
            label="目标日期"
            trigger={
              <RacButton className={`input inline-input inline-date${value.target_date ? '' : ' is-empty'}`}>
                {value.target_date ? friendlyDate(value.target_date, today) : '选一天'}
                <ChevronDown size={14} aria-hidden />
              </RacButton>
            }
          >
            {(close) => (
              <DatePanel
                value={value.target_date}
                today={today}
                quick={false}
                clearLabel={null}
                onChange={(d) => {
                  onChange({ target_date: d });
                  close();
                }}
              />
            )}
          </PopoverPanel>
          {value.target_date && <span className="sentence-note">到时显示「{countdownPhrase(value.target_date, today)}」</span>}
        </div>
      );
  }
}

/** 切换完成方式时补上合理的默认值（计时 10 分钟、计数 1 次）。 */
export function modeDefaults(mode: CompletionMode, cur: CompletionValue): Partial<CompletionValue> {
  if (mode === cur.completion_mode) return {};
  if (mode === 'timer') return { completion_mode: mode, target_value: 10 * 60_000 };
  if (mode === 'count') return { completion_mode: mode, target_value: 1 };
  return { completion_mode: mode };
}

const WEEK = [1, 2, 3, 4, 5, 6, 0];
const WEEK_LABEL = ['日', '一', '二', '三', '四', '五', '六'];
type Freq = Recurrence['kind'];
const FREQ: Array<{ id: Freq; label: string }> = [
  { id: 'daily', label: '每天' },
  { id: 'weekly', label: '每周' },
  { id: 'monthly', label: '每月' },
  { id: 'every', label: '每隔几天' },
];

function defaultRule(kind: Freq, today: DateKey): string {
  if (kind === 'daily') return formatRecurrence({ kind: 'daily' });
  if (kind === 'weekly') return formatRecurrence({ kind: 'weekly', weekdays: [weekday(today)] });
  if (kind === 'monthly') return formatRecurrence({ kind: 'monthly', day: Number(today.slice(8)) });
  return formatRecurrence({ kind: 'every', days: 3, anchor: today });
}

/** 重复：只做一次 / 定期打卡 → 每天、每周几、每月几号、每隔几天。 */
export function RepeatEditor({ value, onChange, today, children }: { value: string | null; onChange: (rule: string | null) => void; today: DateKey; children?: ReactNode }) {
  const r = parseRecurrence(value);
  return (
    <div className="repeat">
      <RadioGroup
        aria-label="多久一次"
        orientation="horizontal"
        className="choice-pills"
        value={r ? 'repeat' : 'once'}
        onChange={(v) => onChange(v === 'once' ? null : defaultRule('daily', today))}
      >
        <Radio value="once" className="choice-pill">
          只做一次
        </Radio>
        <Radio value="repeat" className="choice-pill">
          定期打卡
        </Radio>
      </RadioGroup>
      {r && (
        <div className="repeat-body">
          <ToggleButtonGroup
            aria-label="频率"
            className="freq-chips"
            selectionMode="single"
            disallowEmptySelection
            selectedKeys={[r.kind]}
            onSelectionChange={(keys) => {
              const k = [...keys][0];
              if (k !== undefined && k !== r.kind) onChange(defaultRule(k as Freq, today));
            }}
          >
            {FREQ.map((f) => (
              <ToggleButton key={f.id} id={f.id} className="freq-chip">
                {f.label}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          {r.kind === 'weekly' && (
            <div className="sentence">
              <span>在每周的</span>
              <div className="weekday-picker" role="group" aria-label="每周哪几天">
                {WEEK.map((d) => (
                  <ToggleButton
                    key={d}
                    className="weekday"
                    aria-label={`周${WEEK_LABEL[d]}`}
                    isSelected={r.weekdays.includes(d)}
                    onChange={(on) => {
                      const next = on ? [...r.weekdays, d] : r.weekdays.filter((x) => x !== d);
                      if (next.length) onChange(formatRecurrence({ kind: 'weekly', weekdays: next }));
                    }}
                  >
                    {WEEK_LABEL[d]}
                  </ToggleButton>
                ))}
              </div>
            </div>
          )}
          {r.kind === 'monthly' && (
            <div className="sentence">
              <span>每月</span>
              <InlineNumber label="每月几号" value={r.day} min={1} max={31} width={2} onChange={(v) => v >= 1 && v <= 31 && onChange(formatRecurrence({ kind: 'monthly', day: Math.round(v) }))} />
              <span>号</span>
              {r.day > 28 && <span className="sentence-note">小月取月末</span>}
            </div>
          )}
          {r.kind === 'every' && (
            <div className="sentence">
              <span>每</span>
              <InlineNumber label="间隔天数" value={r.days} min={2} width={2} onChange={(v) => v >= 2 && onChange(formatRecurrence({ kind: 'every', days: Math.round(v), anchor: r.anchor }))} />
              <span>天一次，从今天算起</span>
            </div>
          )}
          {children}
        </div>
      )}
    </div>
  );
}

/** 类型网格（弹层里用）。 */
export function TypeGrid({ types, value, onChange }: { types: TaskType[]; value: string; onChange: (id: string) => void }) {
  return (
    <ToggleButtonGroup
      aria-label="类型"
      className="type-pick-grid"
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={[value]}
      onSelectionChange={(keys) => {
        const k = [...keys][0];
        if (k !== undefined) onChange(String(k));
      }}
    >
      {types.map((t) => {
        const Icon = typeIcon(t.icon);
        return (
          <ToggleButton key={t.id} id={t.id} className="type-pick" style={{ '--chip-color': t.color } as CSSProperties}>
            <span className="type-pick-icon">
              <Icon size={16} />
            </span>
            <span>{t.name}</span>
          </ToggleButton>
        );
      })}
    </ToggleButtonGroup>
  );
}

export const NO_GROUP = '__none';

/** 组列表（弹层里用）。 */
export function GroupList({ store, value, onChange }: { store: Store; value: string | null; onChange: (id: string | null) => void }) {
  const groups = store.list('group');
  return (
    <ListBox
      aria-label="组"
      className="listbox pick-list"
      selectionMode="single"
      selectedKeys={[value ?? NO_GROUP]}
      onSelectionChange={(keys) => {
        if (keys === 'all') return;
        const k = [...keys][0];
        if (k !== undefined) onChange(String(k) === NO_GROUP ? null : String(k));
      }}
    >
      <ListBoxItem id={NO_GROUP} className="listbox-item pick-item" textValue="不放进组">
        <span className="pick-icon muted">—</span>
        <span className="grow">不放进组</span>
        <Check size={14} className="pick-check" />
      </ListBoxItem>
      {groups.map((g) => (
        <ListBoxItem key={g.id} id={g.id} className="listbox-item pick-item" textValue={g.name}>
          <span className="pick-icon">{g.icon}</span>
          <span className="grow">{g.name}</span>
          <Check size={14} className="pick-check" />
        </ListBoxItem>
      ))}
    </ListBox>
  );
}

/** 人物多选（弹层里用）。 */
export function PeopleList({ store, value, onChange }: { store: Store; value: string[]; onChange: (ids: string[]) => void }) {
  const people = store.list('person');
  if (!people.length) return <p className="pick-empty">还没有人物，可以先去「人物」页添加。</p>;
  return (
    <ListBox
      aria-label="和谁有关"
      className="listbox pick-list"
      selectionMode="multiple"
      selectedKeys={value}
      onSelectionChange={(keys) => keys !== 'all' && onChange([...keys].map(String))}
    >
      {people.map((p) => (
        <ListBoxItem key={p.id} id={p.id} className="listbox-item pick-item" textValue={p.name}>
          <Avatar store={store} person={p} size={22} />
          <span className="grow">{p.name}</span>
          {p.relation && <span className="pick-meta">{p.relation}</span>}
          <Check size={14} className="pick-check" />
        </ListBoxItem>
      ))}
    </ListBox>
  );
}

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

/** 类型字段的一个输入。 */
export function FieldInput({ store, def, value, onChange }: { store: Store; def: FieldDef; value: FieldValue | undefined; onChange: (v: FieldValue) => void }) {
  const str = value === null || value === undefined ? '' : Array.isArray(value) ? value.join('\n') : String(value);
  switch (def.kind) {
    case 'select':
      return (
        <Select
          label={def.label}
          value={str || '__none'}
          onChange={(v) => onChange(v === '__none' ? null : v)}
          options={[{ id: '__none', label: '不选' }, ...(def.options ?? []).map((o) => ({ id: o, label: o }))]}
        />
      );
    case 'person': {
      const people = store.list('person');
      return (
        <Select
          label={def.label}
          value={str || '__none'}
          onChange={(v) => onChange(v === '__none' ? null : v)}
          options={[{ id: '__none', label: '不选' }, ...people.map((p) => ({ id: p.id, label: p.name }))]}
        />
      );
    }
    case 'number':
    case 'progress':
      return (
        <Field
          label={def.unit ? `${def.label}（${def.unit}）` : def.label}
          type="number"
          value={str}
          onChange={(v) => onChange(v === '' ? null : Number(v))}
          {...(def.placeholder ? { placeholder: def.placeholder } : {})}
        />
      );
    case 'date':
      return <Field label={def.label} type="date" value={str} onChange={(v) => onChange(v || null)} />;
    case 'list':
      return <Field label={def.label} multiline rows={3} value={str} onChange={(v) => onChange(v.split('\n'))} placeholder="一行写一项" />;
    case 'image': {
      const url = imageUrl(store, value);
      return (
        <div className="field image-field">
          <span className="field-label">{def.label}</span>
          <div className="image-row">
            {url ? <img className="image-preview" src={url} alt="" /> : <span className="image-preview is-empty"><ImagePlus size={18} /></span>}
            <label className="btn btn-secondary file-btn">
              上传图片
              <input
                type="file"
                accept="image/*"
                hidden
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const data = await readFile(f);
                  const a = store.insert('asset', { sha256: '', mime: f.type, width: null, height: null, r2_key: null, url: data });
                  onChange(a.id);
                }}
              />
            </label>
            <Field
              className="grow image-link"
              label={`${def.label}链接`}
              value={typeof value === 'string' && /^https?:/.test(value) ? value : ''}
              onChange={(v) => onChange(v || null)}
              placeholder="或粘贴图片链接"
            />
          </div>
        </div>
      );
    }
    default:
      return (
        <Field
          label={def.label}
          type={def.kind === 'link' ? 'url' : 'text'}
          value={str}
          onChange={(v) => onChange(v || null)}
          {...(def.placeholder ? { placeholder: def.placeholder } : def.kind === 'link' ? { placeholder: 'https://' } : {})}
        />
      );
  }
}

/** 类型字段卡片：主字段在前、占满一行，其余两列。bare：不带标题和底色（详情里放进折叠区时用）。 */
export function TypeFields({ store, type, data, onChange, bare }: { store: Store; type: TaskType; data: Record<string, FieldValue>; onChange: (key: string, v: FieldValue) => void; bare?: boolean }) {
  const Icon = typeIcon(type.icon);
  const fields = [...type.fields].sort((a, b) => Number(!!b.primary) - Number(!!a.primary));
  return (
    <section className={`type-fields${bare ? ' is-bare' : ''}`} style={{ '--chip-color': type.color } as CSSProperties} aria-label={`${type.name}信息`}>
      {!bare && (
        <div className="type-fields-head">
          <Icon size={14} />
          <span>{type.name}信息</span>
        </div>
      )}
      <div className="type-fields-grid">
        {fields.map((f) => (
          <div key={f.key} className={f.primary || f.kind === 'image' || f.kind === 'list' ? 'span-2' : undefined}>
            <FieldInput store={store} def={f} value={data[f.key]} onChange={(v) => onChange(f.key, v)} />
          </div>
        ))}
      </div>
    </section>
  );
}
