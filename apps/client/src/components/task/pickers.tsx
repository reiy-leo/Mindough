/**
 * 新建面板与任务详情共用的属性编辑件。文案规则见 docs/COPY.md。
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
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
import { CalendarClock, Check, ChevronDown, CircleCheck, Hash, ImagePlus, Plus, Timer, X } from 'lucide-react';
import {
  COMPLETION_MODES,
  COMPLETION_MODE_HINT,
  COMPLETION_MODE_LABEL,
  DURATION_UNIT_LABEL,
  MAX_QUICK,
  countConfigForUnit,
  countConfigOf,
  countConfigWithQuick,
  countConfigWithStep,
  countStep,
  formatDelta,
  newCountConfig,
  quickAmounts,
  roundAmount,
  countdownPhrase,
  durationMs,
  durationParts,
  formatRecurrence,
  formatTaskDate,
  multiValuesOf,
  normalizeEpisodeInput,
  fieldText,
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
  type TaskType, weekdayLabel, weekOrder, shownFields, solarToLunar, lunarDayLabel, lunarMonthLabel, nextLunarYearly, formatDate } from '@mindough/core';
import { useDateDisplay } from '../../lib/date-display';
import { Field, InlineNumber, InlineText, MultiSelect, PopoverPanel, Select } from '../../ui/primitives';
import { LinksInput, SiteIdInput } from '../library/LinkFields';
import { MoneyInput } from '../library/MoneyField';
import { DatePanel } from './DatePanel';
import { typeIcon } from '../../lib/icons';
import { imageUrl } from '../../lib/view';
import { saveImageAsset } from '../../lib/upload';

import { dataLabel, tr, trc } from '../../lib/i18n';
import { trx } from '../../lib/trx';
import { useLunarUi } from '../../lib/lunar';
export const MODE_ICON: Record<CompletionMode, typeof Timer> = { once: CircleCheck, timer: Timer, count: Hash, countdown: CalendarClock };

/** 完成方式的选择：四张卡片（单选，方向键可切换）。 */
export function CompletionChoice({ value, onChange, compact }: { value: CompletionMode; onChange: (m: CompletionMode) => void; compact?: boolean }) {
  return (
    <RadioGroup aria-label={tr('怎么算完成')} className={`mode-choice${compact ? ' is-compact' : ''}`} value={value} onChange={(v) => onChange(v as CompletionMode)}>
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

export type CompletionValue = Pick<Task, 'completion_mode' | 'target_value' | 'unit' | 'target_date' | 'count_config'>;

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

/**
 * 计数的设置（Rei 2026-10-26「喝2000mL水的话，每次只能加1，太不合理了」）：
 * 目标 + 单位；每次加多少（选单位时自动填，手改过不再跟着单位变）；最多三个快捷按钮。
 */
function CountSentence({ value, onChange }: { value: CompletionValue; onChange: (p: Partial<CompletionValue>) => void }) {
  const cfg = countConfigOf(value);
  const step = countStep(value);
  const quick = quickAmounts(value);
  const unit = value.unit ?? '';
  const setQuick = (list: number[]) => onChange({ count_config: countConfigWithQuick(cfg, list) });
  return (
    <div className="sentence count-sentence">
      <div className="count-line">
        <span>{tr('目标')}</span>
        <InlineNumber label={tr('目标数量')} value={value.target_value ?? 1} onChange={(v) => onChange({ target_value: Math.max(1, v) })} width={4} />
        <InlineText
          label={tr('单位')}
          value={unit}
          onChange={(u) => {
            const next = u.trim() ? u : null;
            onChange({ unit: next, count_config: countConfigForUnit(cfg, next) });
          }}
          placeholder={tr('次')}
          width={5}
        />
        <span className="sentence-note">{tr('加够就算完成')}</span>
      </div>
      <div className="count-line">
        <span>{tr('每次加')}</span>
        <InlineNumber label={tr('每次加多少')} value={step} min={0.01} onChange={(v) => onChange({ count_config: countConfigWithStep(cfg, v) })} width={4} />
        <span className="sentence-note">{unit || tr('次')}</span>
      </div>
      <div className="count-line count-quick-edit" role="group" aria-label={tr('快捷按钮')}>
        <span>{tr('快捷按钮')}</span>
        {quick.map((q, i) => (
          <span key={i} className="quick-chip">
            <span aria-hidden>+</span>
            <InlineNumber label={tr('快捷按钮 {n}', { n: i + 1 })} value={q} min={0.01} onChange={(v) => setQuick(quick.map((x, j) => (j === i ? v : x)))} width={4} />
            {quick.length > 1 && (
              <RacButton className="quick-chip-x" aria-label={tr('去掉 {amount}', { amount: formatDelta(q) })} onPress={() => setQuick(quick.filter((_, j) => j !== i))}>
                <X size={12} />
              </RacButton>
            )}
          </span>
        ))}
        {quick.length < MAX_QUICK && (
          <RacButton
            className="quick-chip-add"
            aria-label={tr('加一个快捷按钮')}
            onPress={() => {
              let next = roundAmount((quick.at(-1) ?? 0) + step);
              while (quick.includes(next)) next = roundAmount(next + step);
              setQuick([...quick, next]);
            }}
          >
            <Plus size={14} />
          </RacButton>
        )}
      </div>
    </div>
  );
}

/** 选中某种完成方式后，只显示它自己的设置，写成一句话。 */
export function CompletionSentence({ value, onChange, today }: { value: CompletionValue; onChange: (p: Partial<CompletionValue>) => void; today: DateKey }) {
  const dateMode = useDateDisplay();
  switch (value.completion_mode) {
    case 'once':
      return null;
    case 'timer': {
      const parts = durationParts(value.target_value) ?? { value: 10, unit: 'min' as DurationUnit };
      return (
        <div className="sentence">
          <span>{tr('每次')}</span>
          <InlineNumber label={tr('时长')} value={parts.value} onChange={(v) => onChange({ target_value: durationMs(v, parts.unit) })} width={3} />
          <InlineSelect<DurationUnit>
            label={tr('时长单位')}
            value={parts.unit}
            onChange={(u) => onChange({ target_value: durationMs(parts.value, u) })}
            options={(Object.keys(DURATION_UNIT_LABEL) as DurationUnit[]).map((u) => ({ id: u, label: DURATION_UNIT_LABEL[u] }))}
          />
          <span className="sentence-note">{tr('够了就算完成')}</span>
        </div>
      );
    }
    case 'count':
      return <CountSentence value={value} onChange={onChange} />;
    case 'countdown':
      return (
        <div className="sentence">
          <span>{tr('目标日期')}</span>
          <PopoverPanel
            label={tr('目标日期')}
            trigger={
              <RacButton className={`input inline-input inline-date${value.target_date ? '' : ' is-empty'}`}>
                {value.target_date ? formatTaskDate(value.target_date, { mode: dateMode, today }) : tr('选一天')}
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
          {value.target_date && <span className="sentence-note">{tr('到时显示「{countdownPhrase}」', { countdownPhrase: countdownPhrase(value.target_date, today) })}</span>}
        </div>
      );
  }
}

/** 切换完成方式时补上合理的默认值（计时 10 分钟、计数 1 次）。 */
export function modeDefaults(mode: CompletionMode, cur: CompletionValue): Partial<CompletionValue> {
  if (mode === cur.completion_mode) return {};
  if (mode === 'timer') return { completion_mode: mode, target_value: 10 * 60_000 };
  // 计数：按单位填默认步长（Rei 2026-10-26）；已经有步长的（以前设过）不动
  if (mode === 'count') return { completion_mode: mode, target_value: 1, ...(countConfigOf(cur).step ? {} : { count_config: { ...countConfigOf(cur), ...newCountConfig(cur.unit) } }) };
  return { completion_mode: mode };
}

const WEEK = () => weekOrder();
type Freq = Recurrence['kind'];
const FREQ: Array<{ id: Freq; label: string }> = [
  { id: 'daily', get label() { return tr('每天'); } },
  { id: 'weekly', get label() { return tr('每周'); } },
  { id: 'monthly', get label() { return tr('每月'); } },
  { id: 'every', get label() { return tr('每隔几天'); } },
  { id: 'lunarYearly', get label() { return tr('每年农历'); } },
];

function defaultRule(kind: Freq, today: DateKey): string {
  if (kind === 'daily') return formatRecurrence({ kind: 'daily' });
  if (kind === 'weekly') return formatRecurrence({ kind: 'weekly', weekdays: [weekday(today)] });
  if (kind === 'monthly') return formatRecurrence({ kind: 'monthly', day: Number(today.slice(8)) });
  if (kind === 'lunarYearly') {
    const l = solarToLunar(today);
    return formatRecurrence({ kind: 'lunarYearly', month: l?.month ?? 1, day: l?.day ?? 1, leap: l?.leap ?? false });
  }
  return formatRecurrence({ kind: 'every', days: 3, anchor: today });
}

/** 农历月份选项：正月…腊月，后面接 闰正月…闰腊月（闰月要选那一年有的才有意义，见说明）。 */
const LUNAR_MONTH_OPTIONS = () => [
  ...Array.from({ length: 12 }, (_, i) => ({ id: String(i + 1), label: lunarMonthLabel(i + 1) })),
  ...Array.from({ length: 12 }, (_, i) => ({ id: `${i + 1}L`, label: lunarMonthLabel(i + 1, true) })),
];

/** 下一次（含今天）在哪天：「2027年9月15日」。 */
function nextLunarText(r: Extract<Recurrence, { kind: 'lunarYearly' }>, today: DateKey): string {
  const d = nextLunarYearly(r, today);
  return d ? formatDate(d, { year: true }) : '—';
}

/** 重复：只做一次 / 定期打卡 → 每天、每周几、每月几号、每隔几天。 */
export function RepeatEditor({ value, onChange, today, children }: { value: string | null; onChange: (rule: string | null) => void; today: DateKey; children?: ReactNode }) {
  const r = parseRecurrence(value);
  // 农历界面隐藏（没开「中国农历」或不是中文界面，Rei 2026-10-25）：不给「每年农历」这个选项；
  // 已经是每年农历的任务照常按农历重复，这里只显示「每年」+ 下一次的公历日期，不显示农历月日
  const lunarUi = useLunarUi();
  const freqs = FREQ.filter((f) => f.id !== 'lunarYearly' || lunarUi || r?.kind === 'lunarYearly');
  return (
    <div className="repeat">
      <RadioGroup
        aria-label={tr('多久一次')}
        orientation="horizontal"
        className="choice-pills"
        value={r ? 'repeat' : 'once'}
        onChange={(v) => onChange(v === 'once' ? null : defaultRule('daily', today))}
      >
        <Radio value="once" className="choice-pill">
          {tr('只做一次')}</Radio>
        <Radio value="repeat" className="choice-pill">
          {tr('定期打卡')}</Radio>
      </RadioGroup>
      {r && (
        <div className="repeat-body">
          <ToggleButtonGroup
            aria-label={tr('频率')}
            className="freq-chips"
            selectionMode="single"
            disallowEmptySelection
            selectedKeys={[r.kind]}
            onSelectionChange={(keys) => {
              const k = [...keys][0];
              if (k !== undefined && k !== r.kind) onChange(defaultRule(k as Freq, today));
            }}
          >
            {freqs.map((f) => (
              <ToggleButton key={f.id} id={f.id} className="freq-chip">
                {f.id === 'lunarYearly' && !lunarUi ? tr('每年') : f.label}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          {r.kind === 'weekly' && (
            <div className="sentence">
              <span>{tr('在每周的')}</span>
              <div className="weekday-picker" role="group" aria-label={tr('每周哪几天')}>
                {WEEK().map((d) => (
                  <ToggleButton
                    key={d}
                    className="weekday"
                    aria-label={weekdayLabel(d, 'long')}
                    isSelected={r.weekdays.includes(d)}
                    onChange={(on) => {
                      const next = on ? [...r.weekdays, d] : r.weekdays.filter((x) => x !== d);
                      if (next.length) onChange(formatRecurrence({ kind: 'weekly', weekdays: next }));
                    }}
                  >
                    {weekdayLabel(d, 'narrow')}
                  </ToggleButton>
                ))}
              </div>
            </div>
          )}
          {r.kind === 'monthly' && (
            <div className="sentence">
              {trx('在每月的 {day} 号', { day: <InlineNumber label={tr('每月几号')} value={r.day} min={1} max={31} width={2} onChange={(v) => v >= 1 && v <= 31 && onChange(formatRecurrence({ kind: 'monthly', day: Math.round(v) }))} /> }, {}, { wrap: '' })}
              {r.day > 28 && <span className="sentence-note">{tr('小月取月末')}</span>}
            </div>
          )}
          {r.kind === 'lunarYearly' && !lunarUi && (
            <div className="sentence">
              <span className="sentence-note">{tr('下次：{date}', { date: nextLunarText(r, today) })}</span>
            </div>
          )}
          {r.kind === 'lunarYearly' && lunarUi && (
            <div className="sentence lunar-repeat">
              <span>{tr('在每年农历的')}</span>
              <InlineSelect<string>
                label={tr('农历几月')}
                value={`${r.month}${r.leap ? 'L' : ''}`}
                onChange={(v) => onChange(formatRecurrence({ kind: 'lunarYearly', month: parseInt(v, 10), day: r.day, leap: v.endsWith('L') }))}
                options={LUNAR_MONTH_OPTIONS()}
              />
              <InlineSelect<string>
                label={tr('农历几日')}
                value={String(r.day)}
                onChange={(v) => onChange(formatRecurrence({ ...r, day: Number(v) }))}
                options={Array.from({ length: 30 }, (_, i) => ({ id: String(i + 1), label: lunarDayLabel(i + 1) }))}
              />
              <span className="sentence-note">
                {[r.leap ? tr('没有这个闰月的年份按{month}', { month: lunarMonthLabel(r.month) }) : null, r.day === 30 ? tr('小月取廿九') : null].filter(Boolean).join(tr('；')) ||
                  tr('下次：{date}', { date: nextLunarText(r, today) })}
              </span>
            </div>
          )}
          {r.kind === 'every' && (
            <div className="sentence">
              {trx('每 {days} 天一次，从今天算起', { days: <InlineNumber label={tr('间隔天数')} value={r.days} min={2} width={2} onChange={(v) => v >= 2 && onChange(formatRecurrence({ kind: 'every', days: Math.round(v), anchor: r.anchor }))} /> }, { count: r.days }, { wrap: '' })}
            </div>
          )}
          {children}
        </div>
      )}
    </div>
  );
}

export const NO_GROUP = '__none';

/** 组列表（弹层里用）。 */
export function GroupList({ store, value, onChange }: { store: Store; value: string | null; onChange: (id: string | null) => void }) {
  const groups = store.list('group');
  return (
    <ListBox
      aria-label={trc('属性', '项目')}
      className="listbox pick-list"
      selectionMode="single"
      selectedKeys={[value ?? NO_GROUP]}
      onSelectionChange={(keys) => {
        if (keys === 'all') return;
        const k = [...keys][0];
        if (k !== undefined) onChange(String(k) === NO_GROUP ? null : String(k));
      }}
    >
      <ListBoxItem id={NO_GROUP} className="listbox-item pick-item" textValue={tr('不放进项目')}>
        <span className="pick-icon muted">—</span>
        <span className="grow">{tr('不放进项目')}</span>
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

/** 看到哪：可以直接写 S02E03 / 第二季第三集，离开时整理成「第 2 季第 3 集」；别的写法原样留着。 */
function EpisodeInput({ def, value, onChange }: { def: FieldDef; value: FieldValue | undefined; onChange: (v: FieldValue) => void }) {
  const shown = fieldText(value);
  const [text, setText] = useState(shown);
  useEffect(() => {
    if (fieldText(normalizeEpisodeInput(text)) !== shown) setText(shown);
  }, [shown]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Field
      label={dataLabel(def.label)}
      value={text}
      placeholder={def.placeholder ? dataLabel(def.placeholder) : tr('第 2 季第 3 集，或 S02E03')}
      onChange={(t) => {
        setText(t);
        onChange(normalizeEpisodeInput(t));
      }}
      onBlur={() => setText(fieldText(normalizeEpisodeInput(text)))}
    />
  );
}

/** 类型字段的一个输入。 */
export function FieldInput({ store, def, value, onChange }: { store: Store; def: FieldDef; value: FieldValue | undefined; onChange: (v: FieldValue) => void }) {
  const str = value === null || value === undefined ? '' : Array.isArray(value) ? value.join('\n') : String(value);
  switch (def.kind) {
    case 'multiselect':
      return (
        <MultiSelect
          label={dataLabel(def.label)}
          value={multiValuesOf(def, value)}
          onChange={(v) => onChange(v.length ? v : null)}
          options={(def.options ?? []).map((o) => ({ id: o, label: dataLabel(o) }))}
        />
      );
    case 'money':
      return <MoneyInput store={store} def={def} value={value} onChange={onChange} />;
    case 'episode':
      return <EpisodeInput def={def} value={value} onChange={onChange} />;
    case 'site_id':
      return <SiteIdInput def={def} value={value} onChange={onChange} />;
    case 'links':
      return <LinksInput def={def} value={value} onChange={onChange} />;
    case 'select':
      return (
        <Select
          label={dataLabel(def.label)}
          value={str || '__none'}
          onChange={(v) => onChange(v === '__none' ? null : v)}
          options={[{ id: '__none', label: tr('不选') }, ...(def.options ?? []).map((o) => ({ id: o, label: dataLabel(o) }))]}
        />
      );
    case 'person': {
      const people = store.list('person');
      return (
        <Select
          label={dataLabel(def.label)}
          value={str || '__none'}
          onChange={(v) => onChange(v === '__none' ? null : v)}
          options={[{ id: '__none', label: tr('不选') }, ...people.map((p) => ({ id: p.id, label: p.name }))]}
        />
      );
    }
    case 'number':
    case 'progress':
      return (
        <Field
          label={def.unit && !def.label.includes(def.unit) ? tr('{label}（{unit}）', { label: dataLabel(def.label), unit: dataLabel(def.unit) }) : dataLabel(def.label)}
          type="number"
          value={str}
          onChange={(v) => onChange(v === '' ? null : Number(v))}
          {...(def.placeholder ? { placeholder: dataLabel(def.placeholder) } : {})}
        />
      );
    case 'date':
      return <Field label={dataLabel(def.label)} type="date" value={str} onChange={(v) => onChange(v || null)} />;
    case 'list':
      return <Field label={dataLabel(def.label)} multiline rows={3} value={str} onChange={(v) => onChange(v.split('\n'))} placeholder={tr('一行写一项')} />;
    case 'image': {
      const url = imageUrl(store, value);
      return (
        <div className="field image-field">
          <span className="field-label">{dataLabel(def.label)}</span>
          <div className="image-row">
            {url ? <img className="image-preview" src={url} alt="" /> : <span className="image-preview is-empty"><ImagePlus size={18} /></span>}
            <label className="btn btn-secondary file-btn">
              {tr('上传图片')}<input
                type="file"
                accept="image/*"
                hidden
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  onChange(await saveImageAsset(store, f));
                }}
              />
            </label>
            <Field
              className="grow image-link"
              label={tr('{label}链接', { label: dataLabel(def.label) })}
              value={typeof value === 'string' && /^https?:/.test(value) ? value : ''}
              onChange={(v) => onChange(v || null)}
              placeholder={tr('或粘贴图片链接')}
            />
          </div>
        </div>
      );
    }
    default:
      return (
        <Field
          label={dataLabel(def.label)}
          type={def.kind === 'link' ? 'url' : 'text'}
          value={str}
          onChange={(v) => onChange(v || null)}
          {...(def.placeholder ? { placeholder: dataLabel(def.placeholder) } : def.kind === 'link' ? { placeholder: 'https://' } : {})}
        />
      );
  }
}

/** 类型字段卡片：主字段在前、占满一行，其余两列。bare：不带标题和底色（详情里放进折叠区时用）。 */
export function TypeFields({ store, type, data, onChange, bare }: { store: Store; type: TaskType; data: Record<string, FieldValue>; onChange: (key: string, v: FieldValue) => void; bare?: boolean }) {
  const Icon = typeIcon(type.icon);
  const fields = shownFields(type).sort((a, b) => Number(!!b.primary) - Number(!!a.primary));
  return (
    <section className={`type-fields${bare ? ' is-bare' : ''}`} style={{ '--chip-color': type.color } as CSSProperties} aria-label={tr('{name}信息', { name: dataLabel(type.name) })}>
      {!bare && (
        <div className="type-fields-head">
          <Icon size={14} />
          <span>{tr('{name}信息', { name: dataLabel(type.name) })}</span>
        </div>
      )}
      <div className="type-fields-grid">
        {fields.map((f) => (
          <div key={f.key} className={f.primary || f.kind === 'image' || f.kind === 'list' || f.kind === 'links' || f.kind === 'multiselect' ? 'span-2' : undefined}>
            <FieldInput store={store} def={f} value={data[f.key]} onChange={(v) => onChange(f.key, v)} />
          </div>
        ))}
      </div>
    </section>
  );
}
