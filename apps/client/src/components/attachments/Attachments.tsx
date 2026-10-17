/**
 * 附件区（Rei 2026-10-17）：任务详情、日记的正文下面。
 * - 图片：方形小图网格，点开灯箱（Lightbox：关闭、下载、← → 切换）
 * - 其他文件：按类型的图标（FileIcon）+ 文件名 + 大小，点一下下载（保留原文件名）
 * - 「添加附件」选文件（可多选；手机上能选相册），或把文件拖到整块区域上（useFileDrop + DropOverlay）
 * - 上传中显示进度、可取消；失败可重试；离线 / 没登录排队，说明为什么在等
 * - 每个附件：下载、重命名、删除（提示里可撤销）
 */
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Button as RacButton, Dialog, Heading, Input, Modal, ModalOverlay, TextField } from 'react-aria-components';
import { Download, Paperclip, Pencil, RotateCw, Trash2, Upload, X } from 'lucide-react';
import { fileKind, fileKindLabel, fileStem, formatFileSize, isViewableImage, type Attachment, type AttachmentOwnerType } from '@mindough/core';
import { useStore } from '../../store/StoreProvider';
import { useUi } from '../../lib/ui';
import { useSettings } from '../../lib/settings';
import { addAttachments, downloadAttachment, getUploader, revealDownloaded, tooBigMessage, useAttachmentUrl, useUploadState, type UploadState } from '../../lib/attachments';
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
 * 拖放：把文件拖到 ref 这块区域上时 active = true（显示高亮层），松手把文件交给 onFiles。
 * 用捕获阶段，免得编辑器先接住（Milkdown 不处理文件，浏览器会直接打开文件）。只认文件，拖文字不管。
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
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current++;
      setActive(true);
    };
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setActive(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
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

/** 附件区。 */
export function Attachments({ owner, disabled }: { owner: AttachmentOwner; disabled?: boolean }) {
  const store = useStore();
  const ui = useUi();
  const { layout } = useSettings();
  const list = store.attachmentsOf(owner.type, owner.id);
  const images = list.filter((a) => isViewableImage(a));
  const files = list.filter((a) => !isViewableImage(a));
  const input = useRef<HTMLInputElement>(null);
  const add = useAddFiles(owner);
  const [viewing, setViewing] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<Attachment | null>(null);

  const remove = (a: Attachment) => {
    store.removeAttachment(a.id);
    ui.toast({ message: tr('已删除「{name}」', { name: a.file_name }), actions: [{ label: tr('撤销'), onPress: () => store.restoreAttachment(a.id) }] }, 6000);
  };
  const download = async (a: Attachment) => {
    const r = await downloadAttachment(a);
    if (r.ok && r.path) {
      const path = r.path;
      ui.toast({ tone: 'success', message: tr('已存到「下载」：{name}', { name: path.split(/[\\/]/).pop() ?? a.file_name }), actions: [{ label: tr('在文件夹中显示'), onPress: () => void revealDownloaded(path) }] }, 6000);
    } else if (!r.ok) ui.toast({ tone: 'error', message: r.reason === 'missing' ? tr('文件还没传上来，在添加它的设备上联网后就能下载') : tr('没下载成功，稍后再试') }, 5000);
  };
  const actions = { remove, download, rename: setRenaming };

  return (
    <section className={`attachments${list.length ? '' : ' is-empty'}`} aria-label={tr('附件')}>
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
      <Lightbox images={images} openId={viewing} onClose={() => setViewing(null)} onDownload={(a) => void download(a)} />
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

interface Actions {
  remove: (a: Attachment) => void;
  download: (a: Attachment) => Promise<void>;
  rename: (a: Attachment) => void;
}

function menuOf(a: Attachment, act: Actions): MenuAction[] {
  return [
    { id: 'download', label: tr('下载'), icon: <Download size={16} />, onAction: () => void act.download(a) },
    { id: 'rename', label: tr('重命名…'), icon: <Pencil size={16} />, onAction: () => act.rename(a) },
    { id: 'delete', label: tr('删除'), icon: <Trash2 size={16} />, danger: true, onAction: () => act.remove(a) },
  ];
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
  return (
    <li className={`att-tile${s ? ` is-${s.phase}` : ''}`}>
      <RacButton className="att-tile-btn" aria-label={tr('查看图片「{name}」', { name: a.file_name })} onPress={onOpen}>
        {url ? <img src={url} alt="" loading="lazy" draggable={false} /> : <FileIcon name={a.file_name} mime={a.mime} size={36} />}
      </RacButton>
      {status && (
        <span className={`att-tile-status${s?.phase === 'failed' ? ' is-error' : ''}`} aria-live="polite">
          {status}
        </span>
      )}
      <Progress s={s} />
      <span className="att-tile-actions">{s ? <UploadControls a={a} s={s} /> : <OverflowMenu label={tr('附件操作')} items={menuOf(a, actions)} className="att-more" />}</span>
    </li>
  );
}

function FileRow({ a, actions }: { a: Attachment; actions: Actions }) {
  const s = useUploadState(a.id);
  const status = uploadText(s, a);
  const kind = fileKind(a.file_name, a.mime);
  const meta: ReactNode = status ? <span className={s?.phase === 'failed' ? 'is-error' : undefined}>{status}</span> : `${fileKindLabel(kind)} · ${formatFileSize(a.size)}`;
  return (
    <li className={`att-file${s ? ` is-${s.phase}` : ''}`}>
      <RacButton className="att-file-btn" aria-label={tr('下载「{name}」', { name: a.file_name })} onPress={() => void actions.download(a)}>
        <FileIcon name={a.file_name} mime={a.mime} kind={kind} size={36} />
        <span className="att-file-text">
          <span className="att-file-name">{a.file_name}</span>
          <span className="att-file-meta">{meta}</span>
          <Progress s={s} />
        </span>
      </RacButton>
      <span className="att-file-actions">
        {s ? (
          <UploadControls a={a} s={s} />
        ) : (
          <>
            <Tip content={tr('下载')}>
              <RacButton className="icon-btn att-dl" aria-label={tr('下载')} onPress={() => void actions.download(a)}>
                <Download size={16} />
              </RacButton>
            </Tip>
            <OverflowMenu label={tr('附件操作')} items={menuOf(a, actions)} className="att-more" />
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

