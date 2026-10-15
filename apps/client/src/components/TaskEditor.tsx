import { useEffect, useState } from 'react';
import { Tab, TabList, TabPanel, Tabs, ToggleButton, Button as RacButton } from 'react-aria-components';
import { ImagePlus, Link2, Sun, Trash2, X, ArrowRight, ArrowLeft, CircleSlash, RotateCcw } from 'lucide-react';
import {
  COMPLETION_MODE_LABEL,
  TASK_STATUSES,
  formatRecurrence,
  isFinished,
  parseRecurrence,
  predecessorsOf,
  successorsOf,
  taskTitle,
  toDateKey,
  type CompletionMode,
  type FieldDef,
  type FieldValue,
  type Recurrence,
  type Store,
  type Task,
  type TaskStatus,
} from '@mindough/core';
import { useStore } from '../store/StoreProvider';
import { useUi } from '../lib/ui';
import { Button, Field, Segmented, Select, Sheet } from '../ui/primitives';
import { Markdown } from './Markdown';
import { Avatar } from './Avatar';
import { CategoryPicker } from './CheckInCategory';
import { imageUrl, resolver } from '../lib/view';
import { announceComplete, changeStatus, closeTask, toggleMyDay, tryAddDependency } from '../lib/actions';

const WEEK = [1, 2, 3, 4, 5, 6, 0];
const WEEK_LABEL = ['日', '一', '二', '三', '四', '五', '六'];

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function FieldInput({ store, def, value, onChange }: { store: Store; def: FieldDef; value: FieldValue | undefined; onChange: (v: FieldValue) => void }) {
  const str = value === null || value === undefined ? '' : Array.isArray(value) ? value.join('\n') : String(value);
  switch (def.kind) {
    case 'select':
      return (
        <Select
          label={def.label}
          value={str || '__none'}
          onChange={(v) => onChange(v === '__none' ? null : v)}
          options={[{ id: '__none', label: '未选' }, ...(def.options ?? []).map((o) => ({ id: o, label: o }))]}
        />
      );
    case 'person': {
      const people = store.list('person');
      return (
        <Select
          label={def.label}
          value={str || '__none'}
          onChange={(v) => onChange(v === '__none' ? null : v)}
          options={[{ id: '__none', label: '未选' }, ...people.map((p) => ({ id: p.id, label: p.name }))]}
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
          placeholder={def.placeholder}
        />
      );
    case 'date':
      return <Field label={def.label} type="date" value={str} onChange={(v) => onChange(v || null)} />;
    case 'list':
      return <Field label={`${def.label}（每行一项）`} multiline rows={3} value={str} onChange={(v) => onChange(v.split('\n'))} />;
    case 'image': {
      const url = imageUrl(store, value);
      return (
        <div className="field image-field">
          <span className="field-label">{def.label}</span>
          <div className="image-row">
            {url ? <img className="image-preview" src={url} alt="" /> : <span className="image-preview is-empty"><ImagePlus size={18} /></span>}
            <label className="btn btn-secondary file-btn">
              <ImagePlus size={16} />
              上传
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
              className="grow"
              label="或粘贴图片链接"
              value={typeof value === 'string' && /^https?:/.test(value) ? value : ''}
              onChange={(v) => onChange(v || null)}
              placeholder="https://"
            />
          </div>
        </div>
      );
    }
    default:
      return <Field label={def.label} type={def.kind === 'link' ? 'url' : 'text'} value={str} onChange={(v) => onChange(v || null)} placeholder={def.placeholder} />;
  }
}

type RecKind = 'none' | Recurrence['kind'];

function RecurrenceEditor({ value, onChange, today }: { value: string | null; onChange: (rule: string | null) => void; today: string }) {
  const r = parseRecurrence(value);
  const kind: RecKind = r?.kind ?? 'none';
  const set = (k: RecKind) => {
    if (k === 'none') onChange(null);
    else if (k === 'daily') onChange(formatRecurrence({ kind: 'daily' }));
    else if (k === 'weekly') onChange(formatRecurrence({ kind: 'weekly', weekdays: [1, 3, 5] }));
    else if (k === 'monthly') onChange(formatRecurrence({ kind: 'monthly', day: Number(today.slice(8)) }));
    else onChange(formatRecurrence({ kind: 'every', days: 2, anchor: today }));
  };
  return (
    <div className="field">
      <span className="field-label">重复</span>
      <Segmented<RecKind>
        label="重复"
        value={kind}
        onChange={set}
        options={[
          { id: 'none', label: '不重复' },
          { id: 'daily', label: '每天' },
          { id: 'weekly', label: '每周' },
          { id: 'monthly', label: '每月' },
          { id: 'every', label: '每 N 天' },
        ]}
      />
      {r?.kind === 'weekly' && (
        <div className="weekday-picker" role="group" aria-label="每周几">
          {WEEK.map((d) => (
            <ToggleButton
              key={d}
              className="weekday"
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
      )}
      {r?.kind === 'monthly' && (
        <Field label="每月几号" type="number" value={String(r.day)} onChange={(v) => Number(v) >= 1 && Number(v) <= 31 && onChange(formatRecurrence({ kind: 'monthly', day: Number(v) }))} />
      )}
      {r?.kind === 'every' && (
        <Field label="每几天" type="number" value={String(r.days)} onChange={(v) => Number(v) >= 2 && onChange(formatRecurrence({ kind: 'every', days: Number(v), anchor: r.anchor }))} />
      )}
    </div>
  );
}

function DependencyList({ store, task }: { store: Store; task: Task }) {
  const ui = useUi();
  const edges = store.edges();
  const preds = predecessorsOf(edges, task.id).map((id) => store.get('task', id)).filter((t): t is Task => !!t);
  const succs = successorsOf(edges, task.id).map((id) => store.get('task', id)).filter((t): t is Task => !!t);
  const title = (t: Task) => taskTitle(t, store.get('task_type', t.type_id), resolver(store));
  const candidates = store.tasks().filter((t) => t.id !== task.id);
  const options = [{ id: '__pick', label: '选择任务…' }, ...candidates.map((t) => ({ id: t.id, label: title(t).slice(0, 40) }))];
  const derived = store.derived().get(task.id);
  const row = (t: Task, dir: 'pred' | 'succ') => (
    <li key={t.id} className={`dep-item${t.status === '完成' ? ' is-done' : ''}${t.status === '关闭' ? ' is-closed' : ''}`}>
      {dir === 'pred' ? <ArrowLeft size={14} aria-hidden /> : <ArrowRight size={14} aria-hidden />}
      <RacButton className="dep-title" onPress={() => ui.openEditor(t.id)}>
        {title(t)}
      </RacButton>
      <span className="dep-status">{t.status}</span>
      <RacButton
        className="icon-btn"
        aria-label="删除这条依赖"
        onPress={() => (dir === 'pred' ? store.removeDependency(t.id, task.id) : store.removeDependency(task.id, t.id))}
      >
        <X size={14} />
      </RacButton>
    </li>
  );
  return (
    <div className="deps">
      <div className="deps-col">
        <div className="field-label">
          前置（完成后才能开始这个）{derived?.state === '被阻塞' && <span className="meta-state state-blocked">还差 {derived.missing.length} 个</span>}
        </div>
        <ul className="dep-list">{preds.length ? preds.map((t) => row(t, 'pred')) : <li className="dep-empty">没有前置，随时可开始</li>}</ul>
        <Select label="添加前置" value="__pick" options={options} onChange={(id) => id !== '__pick' && tryAddDependency(store, ui, id, task.id)} />
      </div>
      <div className="deps-col">
        <div className="field-label">后续（这个完成后解锁）</div>
        <ul className="dep-list">{succs.length ? succs.map((t) => row(t, 'succ')) : <li className="dep-empty">还没有后续</li>}</ul>
        <div className="dep-actions">
          <Select label="添加后续" value="__pick" options={options} onChange={(id) => id !== '__pick' && tryAddDependency(store, ui, task.id, id)} />
          <Button
            variant="tonal"
            onPress={() => {
              const next = store.createSuccessor(task.id);
              ui.openEditor(next.id);
            }}
          >
            然后呢？新建后续
          </Button>
        </div>
      </div>
    </div>
  );
}

export function TaskEditor() {
  const ui = useUi();
  const store = useStore();
  const task = store.get('task', ui.editingId);
  const [body, setBody] = useState(task?.body_md ?? '');
  useEffect(() => setBody(task?.body_md ?? ''), [task?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!task) return null;
  const today = toDateKey(store.now());
  const type = store.get('task_type', task.type_id);
  const patch = (p: Partial<Task>) => store.updateTask(task.id, p);
  const commitBody = () => body !== task.body_md && patch({ body_md: body });
  const close = () => {
    commitBody();
    ui.openEditor(null);
  };
  const types = store.list('task_type').filter((t) => !t.hidden).sort((a, b) => a.sort - b.sort);
  const people = store.list('person');
  const linked = new Set(store.list('task_person').filter((x) => x.task_id === task.id).map((x) => x.person_id));
  const inDay = store.isInMyDay(task.id, today);

  return (
    <Sheet
      isOpen
      wide
      onOpenChange={(o) => !o && close()}
      title={taskTitle({ ...task, body_md: body }, type, resolver(store))}
      footer={
        <>
          <Button
            variant="danger"
            onPress={() => {
              store.deleteTask(task.id);
              ui.openEditor(null);
              ui.toast({ message: '已删除（墓碑保留，同步后各端一起删除）' }, 3000);
            }}
          >
            <Trash2 size={16} />
            删除
          </Button>
          <span className="grow" />
          <Button variant="secondary" onPress={() => toggleMyDay(store, ui, task.id)}>
            <Sun size={16} />
            {inDay ? '移出我的一天' : '加入我的一天'}
          </Button>
          {isFinished(task.status) ? (
            <Button
              variant="secondary"
              onPress={() => {
                commitBody();
                store.reopenTask(task.id);
                ui.toast({ message: '已重新打开' }, 2500);
              }}
            >
              <RotateCcw size={16} />
              重新打开
            </Button>
          ) : (
            <>
              <Button
                variant="secondary"
                onPress={() => {
                  commitBody();
                  closeTask(store, ui, task.id);
                  ui.openEditor(null);
                }}
              >
                <CircleSlash size={16} />
                关闭
              </Button>
              {!task.recurrence && (
                <Button
                  variant="primary"
                  onPress={() => {
                    commitBody();
                    const prev = task.status;
                    announceComplete(store, ui, store.completeTask(task.id), prev);
                    ui.openEditor(null);
                  }}
                >
                  完成
                </Button>
              )}
            </>
          )}
        </>
      }
    >
      <div className="editor">
        <div className="editor-grid">
          <Select
            label="类型"
            value={task.type_id ?? types[0]!.id}
            options={types.map((t) => ({ id: t.id, label: t.name }))}
            onChange={(id) => {
              const nt = store.get('task_type', id);
              // 改类型时保留已填字段（新类型没有的先隐藏不删）；正文为空时套用模板
              patch({ type_id: nt?.layout === 'text' && nt.fields.length === 0 ? null : id, ...(body.trim() === '' && nt?.body_template ? { body_md: nt.body_template } : {}) });
              if (body.trim() === '' && nt?.body_template) setBody(nt.body_template);
            }}
          />
          <Select label="状态" value={task.status} options={TASK_STATUSES.map((s) => ({ id: s, label: s }))} onChange={(s) => changeStatus(store, ui, task.id, s as TaskStatus)} />
          <Select
            label="组"
            value={task.group_id ?? '__none'}
            options={[{ id: '__none', label: '不分组（琐事）' }, ...store.list('group').map((g) => ({ id: g.id, label: `${g.icon} ${g.name}` }))]}
            onChange={(id) => patch({ group_id: id === '__none' ? null : id })}
          />
          <Field label="日期" type="date" value={task.scheduled_date ?? ''} onChange={(v) => patch({ scheduled_date: v || null })} />
        </div>

        {type && type.fields.length > 0 && (
          <div className="editor-fields">
            {type.fields.map((f) => (
              <FieldInput key={f.key} store={store} def={f} value={task.type_data[f.key]} onChange={(v) => patch({ type_data: { ...task.type_data, [f.key]: v } })} />
            ))}
          </div>
        )}

        <Tabs className="md-tabs">
          <TabList aria-label="正文" className="tablist">
            <Tab id="edit" className="tab">
              编辑
            </Tab>
            <Tab id="preview" className="tab">
              预览
            </Tab>
          </TabList>
          <TabPanel id="edit">
            <div onBlur={commitBody}>
              <Field label="正文（Markdown）" multiline rows={7} value={body} onChange={setBody} placeholder="写点什么…第一行会作为列表里的预览" autoFocus={!task.body_md} />
            </div>
            <div className="hint">
              <Link2 size={12} /> 支持 Markdown：# 标题、- [ ] 清单、**粗体**、链接。离开输入框自动保存。
            </div>
          </TabPanel>
          <TabPanel id="preview">
            <Markdown source={body} className="md-preview" />
          </TabPanel>
        </Tabs>

        <div className="editor-block">
          <span className="field-label">完成方式</span>
          <Segmented<CompletionMode>
            label="完成方式"
            value={task.completion_mode}
            onChange={(m) => patch({ completion_mode: m, ...(m === 'timer' && !task.target_value ? { target_value: 3600_000 } : {}), ...(m === 'count' && !task.target_value ? { target_value: 1 } : {}) })}
            options={(Object.keys(COMPLETION_MODE_LABEL) as CompletionMode[]).map((m) => ({ id: m, label: COMPLETION_MODE_LABEL[m] }))}
          />
          <div className="editor-grid">
            {task.completion_mode === 'count' && (
              <>
                <Field label="目标数量" type="number" value={String(task.target_value ?? 1)} onChange={(v) => patch({ target_value: Math.max(1, Number(v) || 1) })} />
                <Field label="单位" value={task.unit ?? ''} onChange={(v) => patch({ unit: v || null })} placeholder="杯 / 页 / 公里" />
              </>
            )}
            {task.completion_mode === 'timer' && (
              <Field
                label="目标时长（小时，可留空）"
                type="number"
                value={task.target_value ? String(Math.round((task.target_value / 3600_000) * 100) / 100) : ''}
                onChange={(v) => patch({ target_value: v ? Number(v) * 3600_000 : null })}
              />
            )}
            {task.completion_mode === 'countdown' && <Field label="目标日期" type="date" value={task.target_date ?? ''} onChange={(v) => patch({ target_date: v || null })} />}
          </div>
          <RecurrenceEditor value={task.recurrence} onChange={(r) => patch({ recurrence: r })} today={today} />
          {task.recurrence && <CategoryPicker store={store} value={task.checkin_category_id} onChange={(id) => patch({ checkin_category_id: id })} compact />}
        </div>

        {people.length > 0 && (
          <div className="editor-block">
            <span className="field-label">关联人物</span>
            <div className="people-picker">
              {people.map((p) => (
                <ToggleButton
                  key={p.id}
                  className="person-chip"
                  isSelected={linked.has(p.id)}
                  onChange={(on) => (on ? store.linkPerson(task.id, p.id) : store.unlinkPerson(task.id, p.id))}
                >
                  <Avatar store={store} person={p} size={20} />
                  {p.name}
                </ToggleButton>
              ))}
            </div>
          </div>
        )}

        <div className="editor-block">
          <span className="field-label">依赖（FS：完成 → 开始）</span>
          <DependencyList store={store} task={task} />
        </div>
      </div>
    </Sheet>
  );
}
