/**
 * 从滴答清单导入（Rei 2026-10-21：「添加从dida365导入任务的功能，在菜单栏的File/Import/Dida365，点击后弹出一个导入窗口」；
 * 追加「不能直接连接dida365么」→ 两种方式：连接滴答清单（个人 API 令牌，默认）/ 从备份文件导入（.csv）。
 * 入口：桌面菜单栏 文件 → 导入 → 滴答清单、设置 → 数据、⌘K。整个文件按需加载。
 * 拉取 / 读文件 → 同一个中间结构（DidaRow）→ 预览（多少件、每个清单几件、各状态、会新建的组）→ 选项（导哪些状态、清单进哪个组）
 * → 导入 → 结果（成功 / 跳过及原因）+ 撤销。解析、拉取与写入都在 core（@mindough/core/dida，docs/IMPORT-DIDA.md），这里只是界面。
 */
import { useRef, useState, type DragEvent } from 'react';
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Link2, Upload } from 'lucide-react';
import {
  applyDida,
  DidaAbort,
  DidaApiError,
  fetchDidaAccount,
  parseDidaCsv,
  planDida,
  previewDida,
  undoDida,
  type DidaIssue,
  type DidaOptions,
  type DidaPlan,
  type DidaProgress,
  type DidaReceipt,
  type DidaStatus,
  type DidaTarget,
} from '@mindough/core/dida';
import { Button, Field, Segmented, Select, Sheet, Switch } from '../ui/primitives';
import { useStore } from '../store/StoreProvider';
import { useUi } from '../lib/ui';
import { useAccount } from '../lib/account';
import { didaCall, forgetDidaToken, saveDidaToken, savedDidaToken } from '../lib/dida';
import { tr, trc } from '../lib/i18n';
import '../styles/archive.css';

type Source = 'account' | 'file';
type Stage =
  | { kind: 'pick' }
  | { kind: 'busy'; label: string; cancel?: () => void }
  | { kind: 'preview'; plan: DidaPlan; name: string; source: Source }
  | { kind: 'done'; receipt: DidaReceipt; parseErrors: number; source: Source }
  | { kind: 'failed'; message: string };

const ALL_ON: Record<DidaStatus, boolean> = { open: true, done: true, closed: true };
const encode = (t: DidaTarget) => (t.kind === 'group' ? `group:${t.id}` : t.kind);
const decode = (v: string): DidaTarget => (v.startsWith('group:') ? { kind: 'group', id: v.slice(6) } : v === 'new' ? { kind: 'new' } : { kind: 'none' });

/** 「已完成的导入最近多久」：all 全部（默认）、365 / 30 天、0 不导入。 */
type Range = 'all' | '365' | '30' | '0';
const rangeDays = (r: Range): number | null => (r === 'all' ? null : Number(r));

function progressLabel(p: DidaProgress): string {
  if (p.step === 'projects') return tr('正在读清单…');
  if (p.step === 'open') return tr('正在拉未完成的任务（第 {i} / {n} 个清单）…', { i: (p.done ?? 0) + 1, n: p.total ?? 0 });
  if (p.step === 'completed') return tr('正在拉已完成的任务，已经拿到 {n} 件…', { n: p.tasks });
  return tr('正在拉已放弃的任务…');
}

/** 出错提示里的「是哪件」：备份文件写第几行，直接连账户写任务标题。 */
function issueWhere(i: DidaIssue, source: Source): string {
  if (source === 'file' && i.line > 0) return tr('第 {n} 行', { n: i.line });
  return i.title ? tr('「{title}」', { title: i.title }) : '';
}

export function DidaImportSheet({ isOpen, onOpenChange }: { isOpen: boolean; onOpenChange: (open: boolean) => void }) {
  const store = useStore();
  const ui = useUi();
  const [account] = useAccount();
  const [source, setSource] = useState<Source>('account');
  const [stage, setStage] = useState<Stage>({ kind: 'pick' });
  const [include, setInclude] = useState<Record<DidaStatus, boolean>>(ALL_ON);
  const [targets, setTargets] = useState<Record<string, DidaTarget>>({});
  const [dragging, setDragging] = useState(false);
  const [token, setToken] = useState(savedDidaToken);
  const [hasSaved, setHasSaved] = useState(() => !!savedDidaToken());
  const [range, setRange] = useState<Range>('all');
  const input = useRef<HTMLInputElement>(null);
  const signedIn = account.status === 'in';

  const reset = () => {
    setStage({ kind: 'pick' });
    setInclude(ALL_ON);
    setTargets({});
  };
  const close = (open: boolean) => {
    if (!open && stage.kind === 'busy') stage.cancel?.();
    onOpenChange(open);
    if (!open) reset();
  };
  const showPlan = (rows: Parameters<typeof planDida>[1], issues: DidaIssue[], name: string, src: Source) => {
    if (!rows.length) {
      setStage({ kind: 'failed', message: src === 'file' ? tr('文件里没有任务') : tr('滴答清单里没有任务') });
      return;
    }
    setTargets({});
    setStage({ kind: 'preview', plan: planDida(store, rows, issues), name, source: src });
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setStage({ kind: 'busy', label: tr('正在读文件…') });
    try {
      const { rows, issues } = parseDidaCsv(await file.text());
      showPlan(rows, issues, file.name, 'file');
    } catch (e) {
      setStage({ kind: 'failed', message: e instanceof Error ? e.message : String(e) });
    }
  };

  const connect = async () => {
    const t = token.trim();
    if (!t) return;
    const ctl = new AbortController();
    setStage({ kind: 'busy', label: tr('正在连接滴答清单…'), cancel: () => ctl.abort() });
    try {
      const { rows, issues } = await fetchDidaAccount(didaCall(t, ctl.signal), {
        completedDays: rangeDays(range),
        signal: ctl.signal,
        onProgress: (p) => setStage({ kind: 'busy', label: progressLabel(p), cancel: () => ctl.abort() }),
      });
      saveDidaToken(t);
      setHasSaved(true);
      showPlan(rows, issues, tr('滴答清单账户'), 'account');
    } catch (e) {
      if (e instanceof DidaAbort || ctl.signal.aborted) {
        setStage({ kind: 'pick' });
        return;
      }
      let message = e instanceof Error ? e.message : String(e);
      if (e instanceof DidaApiError && e.status === 401) message = tr('令牌不对或已经失效（401 未授权）：在滴答清单里重新生成一个，粘贴到这里再试。');
      if (e instanceof DidaApiError && e.status === -401) message = tr('先在「设置 → 账户」登录念头团（401 未登录），连接要经过念头团的服务器转一下。');
      setStage({ kind: 'failed', message });
    }
  };

  const forget = () => {
    forgetDidaToken();
    setToken('');
    setHasSaved(false);
    ui.toast({ message: tr('已忘记滴答清单的令牌') });
  };

  const confirm = () => {
    if (stage.kind !== 'preview') return;
    const receipt = applyDida(store, stage.plan, optionsOf(include, targets));
    setStage({ kind: 'done', receipt, parseErrors: stage.plan.issues.filter((i) => i.level === 'error').length, source: stage.source });
  };

  const undo = (receipt: DidaReceipt) => {
    undoDida(store, receipt);
    close(false);
    ui.toast({ message: tr('已撤销这次导入') });
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    void onFile(e.dataTransfer.files[0]);
  };

  return (
    <Sheet
      isOpen={isOpen}
      onOpenChange={close}
      title={tr('从滴答清单导入')}
      className="import-sheet dida-sheet"
      footer={
        <Footer
          stage={stage}
          source={source}
          canConnect={signedIn && !!token.trim()}
          include={include}
          targets={targets}
          onCancel={() => close(false)}
          onBack={reset}
          onConnect={() => void connect()}
          onConfirm={confirm}
          onUndo={undo}
        />
      }
    >
      <input
        ref={input}
        type="file"
        accept=".csv,text/csv"
        hidden
        onChange={(e) => {
          const f = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          void onFile(f);
        }}
      />
      {stage.kind === 'pick' && (
        <div className="import-pick">
          <Segmented
            label={tr('导入方式')}
            value={source}
            onChange={setSource}
            options={[
              { id: 'account', label: tr('连接滴答清单') },
              { id: 'file', label: tr('从备份文件导入') },
            ]}
          />
          {source === 'account' ? (
            <div className="dida-connect">
              <p className="muted">
                {tr('在滴答清单网页版点头像 →「设置 → 账户 → API Token」，生成一个令牌粘贴到这里。令牌只存在这台设备上。')}{' '}
                <a href="https://dida365.com/webapp/" target="_blank" rel="noopener noreferrer">
                  {tr('打开滴答清单')}
                </a>
              </p>
              {!signedIn && <p className="dida-warn small">{tr('先在「设置 → 账户」登录念头团：连接要经过念头团的服务器转一下（令牌不会存在服务器上）。')}</p>}
              <Field label={tr('API 令牌')} type="password" value={token} onChange={setToken} placeholder={tr('粘贴令牌')} />
              <Select
                label={tr('已完成的导入最近多久')}
                value={range}
                onChange={(v) => setRange(v as Range)}
                options={[
                  { id: 'all', label: tr('全部') },
                  { id: '365', label: tr('最近一年') },
                  { id: '30', label: tr('最近 30 天') },
                  { id: '0', label: tr('不导入已完成的') },
                ]}
              />
              {hasSaved && (
                <div className="dida-saved small">
                  <Link2 size={14} aria-hidden />
                  <span className="muted">{tr('这台设备记着令牌')}</span>
                  <Button variant="quiet" onPress={forget}>
                    {tr('忘记令牌')}
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <>
              <p className="muted">{tr('在滴答清单（TickTick）网页版的「设置 → 账户与安全」里点「生成备份」，下载下来的 .csv 文件选到这里。')}</p>
              <div
                className={`dida-drop${dragging ? ' is-active' : ''}`}
                onDragEnter={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragOver={(e) => e.preventDefault()}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
                }}
                onDrop={onDrop}
              >
                <Upload size={22} aria-hidden />
                <span>{dragging ? tr('松手就读这个文件') : tr('把备份文件拖到这里')}</span>
                <Button variant="secondary" onPress={() => input.current?.click()}>
                  <FileSpreadsheet size={16} />
                  {tr('选择文件…')}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
      {stage.kind === 'busy' && <p className="muted import-busy" aria-live="polite">{stage.label}</p>}
      {stage.kind === 'failed' && (
        <p className="import-failed">
          <AlertTriangle size={16} />
          {stage.message}
        </p>
      )}
      {stage.kind === 'preview' && <Preview plan={stage.plan} name={stage.name} source={stage.source} include={include} setInclude={setInclude} targets={targets} setTargets={setTargets} />}
      {stage.kind === 'done' && <Result receipt={stage.receipt} parseErrors={stage.parseErrors} source={stage.source} />}
    </Sheet>
  );
}

function Count({ n, label }: { n: number; label: string }) {
  return (
    <div className={`import-count${n === 0 ? ' is-zero' : ''}`}>
      <span className="import-count-n">{n}</span>
      <span className="import-count-label">{label}</span>
    </div>
  );
}

const optionsOf = (include: Record<DidaStatus, boolean>, targets: Record<string, DidaTarget>): DidaOptions => ({ include, targets, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });

function Preview({
  plan,
  name,
  source,
  include,
  setInclude,
  targets,
  setTargets,
}: {
  plan: DidaPlan;
  name: string;
  source: Source;
  include: Record<DidaStatus, boolean>;
  setInclude: (v: Record<DidaStatus, boolean>) => void;
  targets: Record<string, DidaTarget>;
  setTargets: (v: Record<string, DidaTarget>) => void;
}) {
  const store = useStore();
  const c = plan.counts;
  const pv = previewDida(store, plan, optionsOf(include, targets));
  const groups = store.list('group').sort((a, b) => a.name.localeCompare(b.name));
  const errors = plan.issues.filter((i) => i.level === 'error');
  const warnings = plan.issues.filter((i) => i.level === 'warning');
  const extra = [c.notes ? tr('{n} 条笔记', { n: c.notes }) : '', c.subtasks ? tr('{n} 件子任务', { n: c.subtasks }) : '', c.already ? tr('{n} 件以前导入过', { n: c.already }) : ''].filter(Boolean).join(' · ');
  const statusRows: Array<[DidaStatus, string, string, number]> = [
    ['open', tr('未完成的'), tr('导入后是待办'), c.open],
    ['done', tr('已完成的'), tr('导入后是已完成'), c.done],
    ['closed', tr('已放弃的'), tr('导入后是已关闭'), c.closed],
  ];
  return (
    <div className="import-preview">
      <div className="import-source">
        <span className="import-source-name">{name}</span>
        <span className="muted small">{source === 'file' ? tr('滴答清单备份') : tr('刚刚拉取')}</span>
      </div>
      <div className="import-counts" role="group" aria-label={tr('导入预览')}>
        <Count n={c.total} label={trc('导入计数', '任务')} />
        <Count n={c.open} label={trc('导入计数', '未完成')} />
        <Count n={c.done} label={tr('已完成')} />
        <Count n={c.closed} label={tr('已放弃')} />
      </div>
      {extra && <p className="muted small import-breakdown">{tr('其中 {list}', { list: extra })}</p>}

      <div className="dida-section">
        <div className="dida-section-title">{tr('导入哪些')}</div>
        {statusRows
          .filter(([, , , n]) => n > 0)
          .map(([k, label, hint, n]) => (
            <div className="setting" key={k}>
              <div className="setting-text">
                <div className="setting-name">
                  {label}
                  <span className="muted dida-n">{trc('导入计数', '{n} 件', { n })}</span>
                </div>
                <div className="setting-hint">{hint}</div>
              </div>
              <Switch label={label} isSelected={include[k]} onChange={(v) => setInclude({ ...include, [k]: v })} />
            </div>
          ))}
      </div>

      <div className="dida-section">
        <div className="dida-section-title">{tr('清单放进哪个项目')}</div>
        {plan.lists.map((l) => {
          const value = targets[l.name] ?? l.defaultTarget;
          const label = l.name || tr('（没写清单）');
          const options = [
            ...(l.existingGroupId ? [] : [{ id: 'new', label: tr('新建项目「{name}」', { name: l.name || tr('滴答清单') }) }]),
            { id: 'none', label: tr('不放进项目（进待安排）') },
            ...groups.map((g) => ({ id: `group:${g.id}`, label: tr('并入「{name}」', { name: g.name }) })),
          ];
          return (
            <div className="setting dida-list" key={l.name}>
              <div className="setting-text">
                <div className="setting-name">{label}</div>
                <div className="setting-hint">
                  {[l.folder ? tr('文件夹「{name}」', { name: l.folder }) : '', trc('导入计数', '{n} 件', { n: l.total }), l.already ? tr('{n} 件以前导入过', { n: l.already }) : ''].filter(Boolean).join(' · ')}
                </div>
              </div>
              <Select label={tr('「{name}」放进', { name: label })} className="dida-target" value={encode(value)} options={options} onChange={(v) => setTargets({ ...targets, [l.name]: decode(v) })} />
            </div>
          );
        })}
        {pv.newGroups.length > 0 && <p className="muted small dida-note">{tr('会新建 {n} 个项目：{names}', { n: pv.newGroups.length, names: pv.newGroups.map((g) => g || tr('滴答清单')).join(tr('、')) })}</p>}
      </div>

      {(pv.already > 0 || pv.filtered > 0) && (
        <p className="muted small dida-note">
          {[pv.already ? tr('{n} 件以前导入过，这次跳过', { n: pv.already }) : '', pv.filtered ? tr('{n} 件按上面的选择不导入', { n: pv.filtered }) : ''].filter(Boolean).join(tr('；'))}
        </p>
      )}

      {plan.issues.length > 0 && (
        <details className="import-issues" open={errors.length > 0 && errors.length <= 5}>
          <summary>
            {errors.length ? (source === 'file' ? tr('{n} 行读不出来，不导入', { n: errors.length }) : tr('{n} 件读不出来，不导入', { n: errors.length })) : tr('{n} 处和原来不完全一样', { n: warnings.length })}
            {errors.length > 0 && warnings.length > 0 ? tr('，另有 {n} 处和原来不完全一样', { n: warnings.length }) : ''}
          </summary>
          <ul>
            {[...errors, ...warnings].slice(0, 100).map((i, k) => (
              <li key={k} className={i.level === 'error' ? 'is-error' : ''}>
                <span className="import-issue-path">{issueWhere(i, source)}</span>
                <span className="import-issue-msg">{i.message}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function Result({ receipt, parseErrors, source }: { receipt: DidaReceipt; parseErrors: number; source: Source }) {
  const f = receipt.skipped.filtered;
  const filtered = f.open + f.done + f.closed;
  const skipped = receipt.skipped.already + filtered + parseErrors;
  const reasons = [
    receipt.skipped.already ? tr('{n} 件以前导入过', { n: receipt.skipped.already }) : '',
    f.done ? tr('{n} 件已完成的没选', { n: f.done }) : '',
    f.closed ? tr('{n} 件已放弃的没选', { n: f.closed }) : '',
    f.open ? tr('{n} 件未完成的没选', { n: f.open }) : '',
    parseErrors ? tr('{n} 行读不出来', { n: parseErrors }) : '',
  ].filter(Boolean);
  return (
    <div className="import-preview dida-result">
      <p className="dida-result-head">
        <CheckCircle2 size={20} aria-hidden />
        {receipt.created ? tr('导入了 {n} 件任务', { n: receipt.created }) : tr('没有导入新的任务')}
      </p>
      <div className="import-counts dida-result-counts" role="group" aria-label={tr('导入结果')}>
        <Count n={receipt.created} label={tr('成功')} />
        <Count n={skipped} label={trc('导入计数', '跳过')} />
        <Count n={receipt.groups} label={tr('新建的项目')} />
      </div>
      {reasons.length > 0 && <p className="muted small import-breakdown">{tr('跳过的：{list}', { list: reasons.join(' · ') })}</p>}
      {receipt.issues.length > 0 && (
        <details className="import-issues">
          <summary>{tr('{n} 处没接上', { n: receipt.issues.length })}</summary>
          <ul>
            {receipt.issues.slice(0, 100).map((i, k) => (
              <li key={k}>
                <span className="import-issue-path">{issueWhere(i, source)}</span>
                <span className="import-issue-msg">{i.message}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {receipt.created > 0 && <p className="muted small dida-note">{tr('不满意可以撤销，这次导入的任务和新建的项目会一起去掉。')}</p>}
    </div>
  );
}

function Footer({
  stage,
  source,
  canConnect,
  include,
  targets,
  onCancel,
  onBack,
  onConnect,
  onConfirm,
  onUndo,
}: {
  stage: Stage;
  source: Source;
  canConnect: boolean;
  include: Record<DidaStatus, boolean>;
  targets: Record<string, DidaTarget>;
  onCancel: () => void;
  onBack: () => void;
  onConnect: () => void;
  onConfirm: () => void;
  onUndo: (r: DidaReceipt) => void;
}) {
  if (stage.kind === 'pick' && source === 'account')
    return (
      <>
        <span className="grow" />
        <Button variant="secondary" onPress={onCancel}>
          {tr('取消')}
        </Button>
        <Button variant="primary" isDisabled={!canConnect} onPress={onConnect}>
          {tr('连接并读取')}
        </Button>
      </>
    );
  if (stage.kind === 'busy')
    return (
      <>
        <span className="grow" />
        <Button variant="secondary" onPress={stage.cancel ?? onCancel}>
          {tr('取消')}
        </Button>
      </>
    );
  if (stage.kind === 'preview') return <PreviewFooter plan={stage.plan} include={include} targets={targets} onBack={onBack} onConfirm={onConfirm} />;
  if (stage.kind === 'done')
    return (
      <>
        {stage.receipt.created > 0 && (
          <Button variant="secondary" onPress={() => onUndo(stage.receipt)}>
            {tr('撤销这次导入')}
          </Button>
        )}
        <span className="grow" />
        <Button variant="primary" onPress={onCancel}>
          {tr('完成')}
        </Button>
      </>
    );
  if (stage.kind === 'failed')
    return (
      <>
        <span className="grow" />
        <Button variant="secondary" onPress={onBack}>
          {tr('换一个')}
        </Button>
      </>
    );
  return (
    <>
      <span className="grow" />
      <Button variant="secondary" onPress={onCancel}>
        {tr('取消')}
      </Button>
    </>
  );
}

function PreviewFooter({ plan, include, targets, onBack, onConfirm }: { plan: DidaPlan; include: Record<DidaStatus, boolean>; targets: Record<string, DidaTarget>; onBack: () => void; onConfirm: () => void }) {
  const store = useStore();
  const { create } = previewDida(store, plan, optionsOf(include, targets));
  return (
    <>
      <Button variant="secondary" onPress={onBack}>
        {tr('换一个')}
      </Button>
      <span className="grow" />
      <Button variant="primary" isDisabled={create === 0} onPress={onConfirm}>
        {create ? tr('导入 {n} 件', { n: create }) : tr('没有要导入的')}
      </Button>
    </>
  );
}
