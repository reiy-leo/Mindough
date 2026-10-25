/**
 * 附件区（Rei 2026-10-17）：日记的正文下面；任务详情里在属性胶囊正下方（bare，Rei 2026-10-25）。
 * - 任务详情（bare）：没有标题、没有「添加附件」按钮，没附件时整块不渲染；加附件走胶囊行「+」菜单的「附件」或拖文件到详情整列
 * - 图片：方形小图网格，点开灯箱（Lightbox：关闭、下载、← → 切换，只翻图片）
 * - 其他文件（PDF、视频、音频、文档…）一律不预览：按类型的图标（FileIcon）+ 文件名 + 大小，点一下下载（保留原文件名）
 * - 「添加附件」选文件（可多选；手机上能选相册），或把文件拖到整块区域上（useFileDrop + DropOverlay）
 * - 上传中显示进度、可取消；失败可重试；离线 / 没登录排队，说明为什么在等
 * - 每个附件：下载、缓存 / 删除缓存（Rei 2026-10-25，本机副本 24 小时后自动清除）、重命名、删除（提示里可撤销）
 *   桌面：悬停出现 ··· / 右键；触屏：··· / 长按，都是同一个菜单。缓存着的附件有个小硬盘标记。
 * - 离线时没缓存的附件下载不了（按钮灰掉，点了提示）
 */
import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react';
import { Button as RacButton, Dialog, Heading, Input, Modal, ModalOverlay, TextField } from 'react-aria-components';
import { Download, HardDrive, HardDriveDownload, Paperclip, Pencil, RotateCw, Trash2, Upload, X } from 'lucide-react';
import {
  attachmentActionState,
  attachmentPressAction,
  cacheHoursLeft,
  fileKind,
  fileKindLabel,
  fileStem,
  formatFileSize,
  type Attachment,
  type AttachmentActionState,
  type AttachmentOwnerType,
} from '@mindough/core';
import { useStore } from '../../store/StoreProvider';
import { useUi } from '../../lib/ui';
import { useSettings } from '../../lib/settings';
import {
  addAttachments,
  cacheAttachment,
  downloadAttachment,
  getUploader,
  revealDownloaded,
  tooBigMessage,
  uncacheAttachment,
  useAttachmentUrl,
  useOnline,
  useUploadState,
  type DownloadResult,
  type UploadState,
} from '../../lib/attachments';
import { attachmentCache, useCacheRecord } from '../../lib/attachment-cache';
import { Button, OverflowMenu, Tip, type MenuAction } from '../../ui/primitives';
import { FileIcon } from './FileIcon';
import { Lightbox } from './Lightbox';
import { tr } from '../../lib/i18n';

export interface AttachmentOwner {
  type: AttachmentOwnerType;
  id: string;
  /** 日记：那天的日期（加附件前确保那天有一行日记）。 */
  date?: string;
}

/** 选进来 / 拖进来的文件交给它。 */
export function useAddFiles(owner: AttachmentOwner): (files: readonly File[]) => void {
  const store = useStore();
  const ui = useUi();
  return useCallback(
    (files: readonly File[]) => {
      if (!files.length) return;
      void addAttachments(store, owner, files).then(({ tooBig }) => {
        if (tooBig.length) ui.toast({ tone: 'error', message: tooBigMessage(tooBig) }, 6000);
      });
    },
    [store, ui, owner.type, owner.id, owner.date], // eslint-disable-line react-hooks/exhaustive-deps
  );
}

const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');

/**
 * 拖动是不是从这个页面里开始的（编辑器里拖一张图挪位置、拖一段字）：Chrome 拖 <img> 时 types 里也有 Files，
 * 这种不算「拖文件进来」，交给编辑器自己处理。只有从页面外面（访达、桌面、别的 app）拖进来的才加附件。
 */
let internalDrag = false;
if (typeof window !== 'undefined') {
  window.addEventListener('dragstart', () => (internalDrag = true), true);
  const end = () => (internalDrag = false);
  window.addEventListener('dragend', end, true);
  // drop 之后才清（捕获阶段先于各区域的处理，直接清掉它们就分不出来了）；拖到页面外面时只有 dragend
  window.addEventListener('drop', () => setTimeout(end, 0), true);
}
/**
 * 拖进来的只有图片、又落在能改的正文（编辑器）上：交给编辑器上传、插进正文（Rei 2026-10-25 换 Tiptap 时加的，见 extensions.ts uploadPlugin），
 * 不当附件。拖到正文外面、或者混着别的文件，照旧是附件。
 */
export function dropGoesToEditor(e: DragEvent): boolean {
  const t = e.target as Element | null;
  if (!t?.closest?.('.md-editor-root .ProseMirror[contenteditable="true"]')) return false;
  const items = [...(e.dataTransfer?.items ?? [])].filter((i) => i.kind === 'file');
  return items.length > 0 && items.every((i) => i.type.startsWith('image/'));
}
const isFileDrag = (e: DragEvent) => !internalDrag && hasFiles(e) && !dropGoesToEditor(e);

/**
 * 拖放：把文件拖到 ref 这块区域上时 active = true（显示高亮层），松手把文件交给 onFiles。
 * 用捕获阶段，免得编辑器先接住（拖进正文的图片除外，见 dropGoesToEditor）。只认文件，拖文字不管。
 */
export function useFileDrop(ref: RefObject<HTMLElement | null>, onFiles: (files: File[]) => void, enabled = true): boolean {
  const [active, setActive] = useState(false);
  const depth = useRef(0);
  const cb = useRef(onFiles);
  cb.current = onFiles;
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    const enter = (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      depth.current++;
      setActive(true);
    };
    const over = (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const leave = (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setActive(false);
    };
    const drop = (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      depth.current = 0;
      setActive(false);
      const files = [...(e.dataTransfer?.files ?? [])];
      if (files.length) cb.current(files);
    };
    const reset = () => {
      depth.current = 0;
      setActive(false);
    };
    el.addEventListener('dragenter', enter, true);
    el.addEventListener('dragover', over, true);
    el.addEventListener('dragleave', leave, true);
    el.addEventListener('drop', drop, true);
    window.addEventListener('dragend', reset);
    window.addEventListener('blur', reset);
    return () => {
      el.removeEventListener('dragenter', enter, true);
      el.removeEventListener('dragover', over, true);
      el.removeEventListener('dragleave', leave, true);
      el.removeEventListener('drop', drop, true);
      window.removeEventListener('dragend', reset);
      window.removeEventListener('blur', reset);
    };
  }, [ref, enabled]);
  return active;
}

/** 拖放高亮层：盖住整块区域，虚线框 + 「松手添加附件」。 */
export function DropOverlay({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <div className="drop-overlay" aria-hidden>
      <div className="drop-overlay-box">
        <Upload size={26} />
        <span className="drop-overlay-title">{tr('松手添加附件')}</span>
        <span className="drop-overlay-hint">{tr('每个文件不超过 50 MB')}</span>
      </div>
    </div>
  );
}

/**
 * 附件区。bare（任务详情，Rei 2026-10-25「附件section不要label，显示在属性块下方，不显示add attachment按钮」）：
 * 不要标题行和按钮，没附件时整块不渲染。
 */
export function Attachments({ owner, disabled, bare }: { owner: AttachmentOwner; disabled?: boolean; bare?: boolean }) {
  const store = useStore();
  const ui = useUi();
  const { layout } = useSettings();
  const list = store.attachmentsOf(owner.type, owner.id);
  const images = list.filter((a) => attachmentPressAction(a) === 'lightbox');
  const files = list.filter((a) => attachmentPressAction(a) === 'download');
  const online = useOnline();
  const input = useRef<HTMLInputElement>(null);
  const add = useAddFiles(owner);
  const [viewing, setViewing] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<Attachment | null>(null);

  const remove = (a: Attachment) => {
    store.removeAttachment(a.id);
    ui.toast({ message: tr('已删除「{name}」', { name: a.file_name }), actions: [{ label: tr('撤销'), onPress: () => store.restoreAttachment(a.id) }] }, 6000);
  };
  const download = async (a: Attachment) => {
    downloadToast(ui, a, await downloadAttachment(a));
  };
  const cache = async (a: Attachment) => {
    if (await cacheAttachment(a)) ui.toast({ tone: 'success', message: tr('已缓存「{name}」，24 小时后自动清除', { name: a.file_name }) }, 4000);
    else ui.toast({ tone: 'error', message: tr('没缓存成功，稍后再试') }, 4000);
  };
  const uncache = async (a: Attachment) => {
    await uncacheAttachment(a);
    ui.toast({ message: tr('已删除「{name}」的本机缓存', { name: a.file_name }) }, 3000);
  };
  const offlineHint = () => ui.toast({ message: tr('离线中，没缓存的附件下载不了，联网后再试') }, 4000);
  const actions: Actions = { remove, download, rename: setRenaming, cache, uncache, offlineHint, online };

  if (bare && !list.length) return null;

  return (
    <section className={`attachments${list.length ? '' : ' is-empty'}${bare ? ' is-bare' : ''}`} aria-label={tr('附件')}>
      {!bare && (
      <div className="att-head">
        <span className="att-title">
          <Paperclip size={14} aria-hidden />
          {tr('附件')}
          {list.length > 0 && <span className="att-count">{list.length}</span>}
        </span>
        {!list.length && layout !== 'mobile' && <span className="att-hint">{tr('也可以把文件拖到这里')}</span>}
        <span className="grow" />
        <Button variant="quiet" className="att-add" isDisabled={disabled} onPress={() => input.current?.click()}>
          <Paperclip size={15} />
          {tr('添加附件')}
        </Button>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          aria-hidden
          tabIndex={-1}
          onChange={(e) => {
            add([...(e.currentTarget.files ?? [])]);
            e.currentTarget.value = '';
          }}
        />
      </div>
      )}
      {images.length > 0 && (
        <ul className="att-grid" aria-label={tr('图片')}>
          {images.map((a) => (
            <ImageTile key={a.id} a={a} onOpen={() => setViewing(a.id)} actions={actions} />
          ))}
        </ul>
      )}
      {files.length > 0 && (
        <ul className="att-files" aria-label={tr('文件')}>
          {files.map((a) => (
            <FileRow key={a.id} a={a} actions={actions} />
          ))}
        </ul>
      )}
      <Lightbox
        images={images}
        openId={viewing}
        onClose={() => setViewing(null)}
        onDownload={(a) => void download(a)}
        canDownload={(a) => actionStateOf(a, online).download}
      />
      <RenameDialog
        attachment={renaming}
        onClose={() => setRenaming(null)}
        onRename={(a, name) => {
          if (!store.renameAttachment(a.id, name)) ui.toast({ tone: 'error', message: tr('名字不能是空的') }, 3000);
        }}
      />
    </section>
  );
}

type Toaster = ReturnType<typeof useUi>;

/** 下载结果的提示（附件区、灯箱共用）。取消保存框不提示。 */
function downloadToast(ui: Toaster, a: Attachment, r: DownloadResult) {
  if (r.ok && r.path) {
    const path = r.path;
    const name = path.split(/[\\/]/).pop() ?? a.file_name;
    ui.toast(
      { tone: 'success', message: r.folder === 'chosen' ? tr('已保存：{name}', { name }) : tr('已存到「下载」：{name}', { name }), actions: [{ label: tr('在文件夹中显示'), onPress: () => void revealDownloaded(path) }] },
      6000,
    );
  } else if (!r.ok && r.reason !== 'cancelled')
    ui.toast(
      {
        tone: 'error',
        message:
          r.reason === 'missing'
            ? tr('文件还没传上来，在添加它的设备上联网后就能下载')
            : r.reason === 'offline'
              ? tr('离线中，没缓存的附件下载不了，联网后再试')
              : tr('没下载成功，稍后再试'),
      },
      5000,
    );
}

interface Actions {
  remove: (a: Attachment) => void;
  download: (a: Attachment) => Promise<void>;
  rename: (a: Attachment) => void;
  cache: (a: Attachment) => Promise<void>;
  uncache: (a: Attachment) => Promise<void>;
  offlineHint: () => void;
  online: boolean;
}

/** 这个附件的操作能不能用（缓存记录 + 是否在本机队列 + 联网）。 */
function actionStateOf(a: Attachment, online: boolean, pending = false): AttachmentActionState {
  return attachmentActionState(a, { cached: !!attachmentCache().record(a), online, pending });
}

export function menuOf(a: Attachment, act: Pick<Actions, 'remove' | 'download' | 'rename' | 'cache' | 'uncache'>, st: AttachmentActionState): MenuAction[] {
  const items: MenuAction[] = [{ id: 'download', label: tr('下载'), icon: <Download size={16} />, disabled: !st.download, onAction: () => void act.download(a) }];
  if (st.cacheItem === 'cache') items.push({ id: 'cache', label: tr('缓存'), icon: <HardDriveDownload size={16} />, disabled: !st.cacheEnabled, onAction: () => void act.cache(a) });
  if (st.cacheItem === 'remove-cache') items.push({ id: 'uncache', label: tr('删除缓存'), icon: <HardDrive size={16} />, onAction: () => void act.uncache(a) });
  items.push(
    { id: 'rename', label: tr('重命名…'), icon: <Pencil size={16} />, onAction: () => act.rename(a) },
    { id: 'delete', label: tr('删除'), icon: <Trash2 size={16} />, danger: true, separator: true, onAction: () => act.remove(a) },
  );
  return items;
}

const LONG_PRESS_MS = 500;

/**
 * 同一个 ··· 菜单的三种打开方式：点 ···、右键（桌面）、长按（触屏，iOS 不发 contextmenu，所以自己计时）。
 * 长按触发后，紧跟着的那次点击（打开灯箱 / 下载）吞掉。enabled = false（正在上传）时不拦右键。
 */
function useItemMenu(enabled: boolean) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const armed = useRef(false);
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  };
  useEffect(() => clear, []);
  // 手指抬起后再打开菜单：按着时打开，抬手那一下会被弹层当成「点了外面」立刻关掉
  const release = () => {
    clear();
    if (!armed.current) return;
    armed.current = false;
    setTimeout(() => setOpen(true), 30);
  };
  const bind = enabled
    ? {
        onContextMenu: (e: ReactMouseEvent) => {
          e.preventDefault();
          if (armed.current) return; // 长按已经在处理（Android 也会发 contextmenu）
          clear();
          setOpen(true);
        },
        // 捕获阶段：React Aria 的按钮在冒泡阶段会把 pointer 事件停掉
        onPointerDownCapture: (e: ReactPointerEvent) => {
          fired.current = false;
          armed.current = false;
          if (e.pointerType !== 'touch') return;
          start.current = { x: e.clientX, y: e.clientY };
          timer.current = setTimeout(() => {
            fired.current = true;
            armed.current = true;
            timer.current = null;
            navigator.vibrate?.(10);
          }, LONG_PRESS_MS);
        },
        onPointerMoveCapture: (e: ReactPointerEvent) => {
          const s = start.current;
          if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 10) clear();
        },
        onPointerUpCapture: release,
        onTouchEndCapture: release,
        onPointerCancelCapture: release,
      }
    : {};
  /** 点击时先问一下：刚长按打开过菜单就别再做点击的事。 */
  const consume = () => {
    const f = fired.current;
    fired.current = false;
    return f;
  };
  return { open, setOpen, bind, consume };
}

/** 缓存着的小标记（悬停看还剩几小时）。 */
function CachedBadge({ a, className }: { a: Attachment; className: string }) {
  const { record, busy } = useCacheRecord(a);
  if (!record && !busy) return null;
  const label = record ? tr('已缓存到本机，{h} 小时后清除', { h: cacheHoursLeft(record, attachmentCache().now()) }) : tr('正在缓存…');
  return (
    <Tip content={label}>
      <span className={`${className}${busy ? ' is-busy' : ''}`} role="img" aria-label={label} tabIndex={-1}>
        <HardDrive size={12} aria-hidden />
      </span>
    </Tip>
  );
}

/** 上传状态那一行字。 */
export function uploadText(s: UploadState | undefined, a: Attachment): string | null {
  if (s?.phase === 'uploading') return tr('正在上传 {p}%', { p: s.total ? Math.min(99, Math.floor((s.loaded / s.total) * 100)) : 0 });
  if (s?.phase === 'queued') return tr('等着上传');
  if (s?.phase === 'offline') return tr('等联网后上传');
  if (s?.phase === 'signed-out') return tr('登录后上传');
  if (s?.phase === 'failed') return tr('上传失败');
  if (!a.r2_key) return tr('还在另一台设备上');
  return null;
}

/** 正在传 / 排着 / 失败的附件旁边的按钮：取消、重试。 */
function UploadControls({ a, s }: { a: Attachment; s: UploadState | undefined }) {
  if (!s) return null;
  return (
    <>
      {s.phase === 'failed' && (
        <Tip content={s.error ? tr('重试（{error}）', { error: s.error }) : tr('重试')}>
          <RacButton className="icon-btn att-retry" aria-label={tr('重试')} onPress={() => getUploader()?.retry(a.id)}>
            <RotateCw size={15} />
          </RacButton>
        </Tip>
      )}
      <Tip content={tr('取消上传')}>
        <RacButton className="icon-btn att-cancel" aria-label={tr('取消上传「{name}」', { name: a.file_name })} onPress={() => void getUploader()?.cancel(a.id)}>
          <X size={15} />
        </RacButton>
      </Tip>
    </>
  );
}

function Progress({ s }: { s: UploadState | undefined }) {
  if (!s || (s.phase !== 'uploading' && s.phase !== 'queued')) return null;
  const v = s.phase === 'uploading' && s.total ? s.loaded / s.total : 0;
  return (
    <span className={`att-progress${s.phase === 'queued' ? ' is-queued' : ''}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)}>
      <span className="att-progress-bar" style={{ width: `${Math.round(v * 100)}%` }} />
    </span>
  );
}

function ImageTile({ a, onOpen, actions }: { a: Attachment; onOpen: () => void; actions: Actions }) {
  const url = useAttachmentUrl(a, 'thumb');
  const s = useUploadState(a.id);
  const status = uploadText(s, a);
  useCacheRecord(a);
  const st = actionStateOf(a, actions.online, !!s);
  const menu = useItemMenu(!s);
  return (
    <li className={`att-tile${s ? ` is-${s.phase}` : ''}`} {...menu.bind}>
      <RacButton className="att-tile-btn" aria-label={tr('查看图片「{name}」', { name: a.file_name })} onPress={() => !menu.consume() && onOpen()}>
        {url ? <img src={url} alt="" loading="lazy" draggable={false} /> : <FileIcon name={a.file_name} mime={a.mime} size={36} />}
      </RacButton>
      <CachedBadge a={a} className="att-cached att-tile-cached" />
      {status && (
        <span className={`att-tile-status${s?.phase === 'failed' ? ' is-error' : ''}`} aria-live="polite">
          {status}
        </span>
      )}
      <Progress s={s} />
      <span className={`att-tile-actions${menu.open ? ' is-open' : ''}`}>
        {s ? <UploadControls a={a} s={s} /> : <OverflowMenu label={tr('附件操作')} items={menuOf(a, actions, st)} className="att-more" isOpen={menu.open} onOpenChange={menu.setOpen} />}
      </span>
    </li>
  );
}

function FileRow({ a, actions }: { a: Attachment; actions: Actions }) {
  const s = useUploadState(a.id);
  const status = uploadText(s, a);
  const kind = fileKind(a.file_name, a.mime);
  useCacheRecord(a);
  const st = actionStateOf(a, actions.online, !!s);
  const menu = useItemMenu(!s);
  const meta: ReactNode = status ? <span className={s?.phase === 'failed' ? 'is-error' : undefined}>{status}</span> : `${fileKindLabel(kind)} · ${formatFileSize(a.size)}`;
  // 不预览：点一下就是下载；离线又没缓存时只提示
  const press = () => {
    if (menu.consume()) return;
    if (st.downloadBlocked === 'offline') actions.offlineHint();
    else void actions.download(a);
  };
  return (
    <li className={`att-file${s ? ` is-${s.phase}` : ''}${st.download ? '' : ' is-unavailable'}${menu.open ? ' is-menu-open' : ''}`} {...menu.bind}>
      <RacButton className="att-file-btn" aria-label={tr('下载「{name}」', { name: a.file_name })} onPress={press}>
        <FileIcon name={a.file_name} mime={a.mime} kind={kind} size={36} />
        <span className="att-file-text">
          <span className="att-file-name">{a.file_name}</span>
          <span className="att-file-meta">
            <CachedBadge a={a} className="att-cached att-file-cached" />
            {meta}
          </span>
          <Progress s={s} />
        </span>
      </RacButton>
      <span className="att-file-actions">
        {s ? (
          <UploadControls a={a} s={s} />
        ) : (
          <>
            <Tip content={st.download ? tr('下载') : tr('离线中，没缓存的附件下载不了')}>
              <RacButton className="icon-btn att-dl" aria-label={st.download ? tr('下载') : tr('离线中，没缓存的附件下载不了')} isDisabled={!st.download} onPress={() => void actions.download(a)}>
                <Download size={16} />
              </RacButton>
            </Tip>
            <OverflowMenu label={tr('附件操作')} items={menuOf(a, actions, st)} className="att-more" isOpen={menu.open} onOpenChange={menu.setOpen} />
          </>
        )}
      </span>
    </li>
  );
}

/** 重命名（只选中主干，扩展名不写就保留原来的）。 */
function RenameDialog({ attachment, onClose, onRename }: { attachment: Attachment | null; onClose: () => void; onRename: (a: Attachment, name: string) => void }) {
  const [name, setName] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!attachment) return;
    setName(attachment.file_name);
    const stem = fileStem(attachment.file_name).length;
    requestAnimationFrame(() => ref.current?.setSelectionRange(0, stem));
  }, [attachment]);
  return (
    <ModalOverlay isOpen={!!attachment} onOpenChange={(o) => !o && onClose()} isDismissable className="overlay overlay-alert">
      <Modal className="modal modal-alert">
        <Dialog className="dialog alert" aria-label={tr('重命名附件')}>
          {({ close }) => (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (attachment) onRename(attachment, name);
                close();
              }}
            >
              <Heading slot="title" className="alert-title">
                {tr('重命名附件')}
              </Heading>
              <TextField className="att-rename" aria-label={tr('文件名')} value={name} onChange={setName} autoFocus>
                <Input ref={ref} className="input" />
              </TextField>
              <div className="alert-actions">
                <Button variant="secondary" onPress={close}>
                  {tr('取消')}
                </Button>
                <Button variant="primary" type="submit">
                  {tr('改名')}
                </Button>
              </div>
            </form>
          )}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

