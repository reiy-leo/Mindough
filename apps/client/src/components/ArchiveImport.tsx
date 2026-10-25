/**
 * 导入（设置 → 数据 → 导入…）：选 zip 或文件夹 → 预览（新建 / 更新 / 跳过 / 出错）→ 确认后一次写入，提示里可整批撤销。
 * 解析与写入都在 core（archive/import.ts），这里只是界面。整个文件由设置页按需加载（yaml + fflate 不进首屏包）。
 */
import { useRef, useState } from 'react';
import { AlertTriangle, FileArchive, FolderOpen } from 'lucide-react';
import { summarizeImport, type ArchiveFile, type ImportPlan } from '@mindough/core/archive';
import { Button, Sheet, Switch } from '../ui/primitives';
import { useStore } from '../store/StoreProvider';
import { useUi } from '../lib/ui';
import { loadArchive, queueImportedAttachments, readPicked, uploadPlanImages } from '../lib/archive';
import { tr } from '../lib/i18n';
import '../styles/archive.css';

type Stage = { kind: 'pick' } | { kind: 'busy'; label: string } | { kind: 'preview'; plan: ImportPlan; files: ArchiveFile[]; name: string } | { kind: 'failed'; message: string };

export function ArchiveImportSheet({ isOpen, onOpenChange }: { isOpen: boolean; onOpenChange: (open: boolean) => void }) {
  const store = useStore();
  const ui = useUi();
  const [stage, setStage] = useState<Stage>({ kind: 'pick' });
  const [overwrite, setOverwrite] = useState(false);
  const zipInput = useRef<HTMLInputElement>(null);
  const dirInput = useRef<HTMLInputElement>(null);

  const close = (open: boolean) => {
    onOpenChange(open);
    if (!open) {
      setStage({ kind: 'pick' });
      setOverwrite(false);
    }
  };

  const onPicked = async (list: File[]) => {
    if (!list.length) return;
    setStage({ kind: 'busy', label: tr('正在读文件…') });
    try {
      const { files, name } = await readPicked(list);
      const ar = await loadArchive();
      setStage({ kind: 'preview', plan: ar.planImport(store, files), files, name });
    } catch (e) {
      setStage({ kind: 'failed', message: e instanceof Error ? e.message : String(e) });
    }
  };

  const pick = (input: HTMLInputElement) => {
    const files = input.files ? [...input.files] : [];
    input.value = '';
    void onPicked(files);
  };

  const confirm = async () => {
    if (stage.kind !== 'preview') return;
    const { files } = stage;
    let plan = stage.plan;
    const ar = await loadArchive();
    if (plan.imagePaths.length) {
      setStage({ kind: 'busy', label: tr('正在上传图片…') });
      const urls = await uploadPlanImages(plan, files);
      if (urls.size) plan = ar.planImport(store, files, { assetUrls: urls });
    }
    const receipt = ar.applyImport(store, plan, { overwrite });
    await queueImportedAttachments(store, plan, files);
    const n = receipt.counts.create + receipt.counts.update;
    close(false);
    ui.toast(
      {
        tone: 'success',
        message: receipt.issues.length ? tr('导入了 {n} 项，有 {m} 处没接上', { n, m: receipt.issues.length }) : tr('导入了 {n} 项', { n }),
        actions: [
          {
            label: tr('撤销'),
            onPress: () => {
              ar.undoImport(store, receipt);
              ui.toast({ message: tr('已撤销这次导入') });
            },
          },
        ],
      },
      10000,
    );
  };

  return (
    <Sheet isOpen={isOpen} onOpenChange={close} title={tr('导入')} className="import-sheet" footer={<Footer stage={stage} overwrite={overwrite} onCancel={() => close(false)} onBack={() => setStage({ kind: 'pick' })} onConfirm={() => void confirm()} />}>
      <input ref={zipInput} type="file" accept=".zip,application/zip" hidden onChange={(e) => pick(e.currentTarget)} />
      <input
        ref={dirInput}
        type="file"
        hidden
        multiple
        {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
        onChange={(e) => pick(e.currentTarget)}
      />
      {stage.kind === 'pick' && (
        <div className="import-pick">
          <p className="muted">{tr('选念头团导出的 zip，或者任何 Markdown 文件夹：每个 .md 是一件任务，文件夹是项目。')}</p>
          <div className="import-pick-actions">
            <Button variant="secondary" onPress={() => zipInput.current?.click()}>
              <FileArchive size={16} />
              {tr('选择 zip…')}
            </Button>
            <Button variant="secondary" onPress={() => dirInput.current?.click()}>
              <FolderOpen size={16} />
              {tr('选择文件夹…')}
            </Button>
          </div>
        </div>
      )}
      {stage.kind === 'busy' && <p className="muted import-busy">{stage.label}</p>}
      {stage.kind === 'failed' && (
        <p className="import-failed">
          <AlertTriangle size={16} />
          {stage.message}
        </p>
      )}
      {stage.kind === 'preview' && <Preview plan={stage.plan} name={stage.name} overwrite={overwrite} setOverwrite={setOverwrite} />}
    </Sheet>
  );
}

function Preview({ plan, name, overwrite, setOverwrite }: { plan: ImportPlan; name: string; overwrite: boolean; setOverwrite: (v: boolean) => void }) {
  const s = summarizeImport(plan, overwrite);
  const existing = plan.entries.filter((e) => e.kind !== 'extra' && e.state === 'existing').length;
  const errors = plan.issues.filter((i) => i.level === 'error');
  const warnings = plan.issues.filter((i) => i.level === 'warning');
  const kinds: Array<[keyof typeof s.byKind, (n: number) => string]> = [
    ['task', (n) => tr('{n} 件任务', { n })],
    ['group', (n) => tr('{n} 个项目', { n })],
    ['library', (n) => tr('{n} 条资料', { n })],
    ['person', (n) => tr('{n} 位人物', { n })],
    ['type', (n) => tr('{n} 个类型', { n })],
    ['journal', (n) => tr('{n} 篇日记', { n })],
    ['attachment', (n) => tr('{n} 个附件', { n })],
  ];
  const breakdown = kinds
    .map(([k, label]) => label(s.byKind[k].create + s.byKind[k].update))
    .filter((_, i) => s.byKind[kinds[i]![0]].create + s.byKind[kinds[i]![0]].update > 0)
    .join(' · ');
  return (
    <div className="import-preview">
      <div className="import-source">
        <span className="import-source-name">{name || tr('选中的文件')}</span>
        <span className="muted small">{plan.format === 'mindough' ? tr('念头团导出') : tr('Markdown 文件夹')}</span>
      </div>
      <div className="import-counts" role="group" aria-label={tr('导入预览')}>
        <Count n={s.create} label={tr('新建')} />
        <Count n={s.update} label={tr('更新')} />
        <Count n={s.skip} label={tr('跳过')} />
        <Count n={errors.length} label={tr('出错')} tone={errors.length ? 'error' : undefined} />
      </div>
      {breakdown && <p className="muted small import-breakdown">{tr('其中 {list}', { list: breakdown })}</p>}
      {existing > 0 && (
        <div className="setting import-overwrite">
          <div className="setting-text">
            <div className="setting-name">{tr('已有的用文件覆盖')}</div>
            <div className="setting-hint">{overwrite ? tr('{n} 项会改成文件里的样子', { n: existing }) : tr('{n} 项这里已经有了，改过的也先跳过', { n: existing })}</div>
          </div>
          <Switch label={tr('已有的用文件覆盖')} isSelected={overwrite} onChange={setOverwrite} />
        </div>
      )}
      {plan.issues.length > 0 && (
        <details className="import-issues" open={errors.length > 0 && errors.length <= 5}>
          <summary>{errors.length ? tr('{n} 个文件没导入', { n: errors.length }) : tr('{n} 处没接上', { n: warnings.length })}{errors.length > 0 && warnings.length > 0 ? tr('，另有 {n} 处没接上', { n: warnings.length }) : ''}</summary>
          <ul>
            {[...errors, ...warnings].slice(0, 100).map((i, k) => (
              <li key={k} className={i.level === 'error' ? 'is-error' : ''}>
                <span className="import-issue-path">{i.path}</span>
                <span className="import-issue-msg">{i.message}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function Count({ n, label, tone }: { n: number; label: string; tone?: 'error' | undefined }) {
  return (
    <div className={`import-count${tone ? ` is-${tone}` : ''}${n === 0 ? ' is-zero' : ''}`}>
      <span className="import-count-n">{n}</span>
      <span className="import-count-label">{label}</span>
    </div>
  );
}

function Footer({ stage, overwrite, onCancel, onBack, onConfirm }: { stage: Stage; overwrite: boolean; onCancel: () => void; onBack: () => void; onConfirm: () => void }) {
  if (stage.kind === 'preview') {
    const s = summarizeImport(stage.plan, overwrite);
    const n = s.create + s.update;
    return (
      <>
        <Button variant="secondary" onPress={onBack}>
          {tr('换一个')}
        </Button>
        <span className="grow" />
        <Button variant="primary" isDisabled={n === 0} onPress={onConfirm}>
          {n ? tr('导入 {n} 项', { n }) : tr('没有要导入的')}
        </Button>
      </>
    );
  }
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
