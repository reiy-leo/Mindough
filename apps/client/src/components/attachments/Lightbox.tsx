/**
 * 图片灯箱（Rei 2026-10-17：「附件是图片则小图显示点击可放大(有关闭、下载按钮)」）。
 * 全屏深色底，图片按原比例尽量大；顶栏：文件名、第几张、下载、关闭。多张时左右箭头、← → 键切换，手机上左右滑。
 * Esc、点图片外面的地方关闭。四周留出安全区（刘海、Home 条）。
 */
import { useEffect, useRef, useState } from 'react';
import { Button as RacButton, Dialog, Modal, ModalOverlay } from 'react-aria-components';
import { ChevronLeft, ChevronRight, Download, X } from 'lucide-react';
import type { Attachment } from '@mindough/core';
import { useAttachmentUrl } from '../../lib/attachments';
import { tr } from '../../lib/i18n';

export function Lightbox({ images, openId, onClose, onDownload }: { images: readonly Attachment[]; openId: string | null; onClose: () => void; onDownload: (a: Attachment) => void }) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (!openId) return;
    const i = images.findIndex((a) => a.id === openId);
    setIndex(i < 0 ? 0 : i);
  }, [openId]); // eslint-disable-line react-hooks/exhaustive-deps
  const open = !!openId && images.length > 0;
  const i = Math.min(index, Math.max(0, images.length - 1));
  const cur = images[i];
  const many = images.length > 1;
  const go = (d: number) => setIndex((x) => (x + d + images.length) % images.length);
  // 删到最后一张时关掉
  useEffect(() => {
    if (openId && images.length === 0) onClose();
  }, [openId, images.length, onClose]);

  return (
    <ModalOverlay isOpen={open} onOpenChange={(o) => !o && onClose()} isDismissable className="lightbox-overlay">
      <Modal className="lightbox-modal">
        <Dialog className="lightbox" aria-label={cur ? tr('图片「{name}」', { name: cur.file_name }) : tr('图片')}>
          {cur && (
            <div
              className="lightbox-body"
              onKeyDown={(e) => {
                if (!many) return;
                if (e.key === 'ArrowLeft') {
                  e.preventDefault();
                  go(-1);
                } else if (e.key === 'ArrowRight') {
                  e.preventDefault();
                  go(1);
                }
              }}
            >
              <div className="lightbox-bar">
                <div className="lightbox-title">
                  <span className="lightbox-name">{cur.file_name}</span>
                  {many && <span className="lightbox-count">{tr('{i} / {n}', { i: i + 1, n: images.length })}</span>}
                </div>
                <RacButton className="lightbox-btn" aria-label={tr('下载')} onPress={() => onDownload(cur)}>
                  <Download size={20} />
                </RacButton>
                <RacButton className="lightbox-btn" aria-label={tr('关闭')} onPress={onClose} autoFocus>
                  <X size={22} />
                </RacButton>
              </div>
              <Stage key={cur.id} a={cur} onBackdrop={onClose} onSwipe={many ? go : undefined} />
              {many && (
                <>
                  <RacButton className="lightbox-nav is-prev" aria-label={tr('上一张')} onPress={() => go(-1)}>
                    <ChevronLeft size={26} />
                  </RacButton>
                  <RacButton className="lightbox-nav is-next" aria-label={tr('下一张')} onPress={() => go(1)}>
                    <ChevronRight size={26} />
                  </RacButton>
                </>
              )}
            </div>
          )}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

/** 点在 object-fit: contain 的图片画面里吗。 */
function insideContent(img: HTMLImageElement, x: number, y: number): boolean {
  const r = img.getBoundingClientRect();
  const k = Math.min(r.width / img.naturalWidth, r.height / img.naturalHeight);
  const w = img.naturalWidth * k;
  const h = img.naturalHeight * k;
  const left = r.left + (r.width - w) / 2;
  const top = r.top + (r.height - h) / 2;
  return x >= left && x <= left + w && y >= top && y <= top + h;
}

/** 一张图：先显示缩略图，原图到了换上。点图片外面关闭；左右滑切换。 */
function Stage({ a, onBackdrop, onSwipe }: { a: Attachment; onBackdrop: () => void; onSwipe?: (d: number) => void }) {
  const thumb = useAttachmentUrl(a, 'thumb');
  const full = useAttachmentUrl(a, 'full');
  const [loaded, setLoaded] = useState(false);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const src = loaded && full ? full : (thumb ?? full);
  return (
    <div
      className="lightbox-stage"
      onClick={(e) => {
        // 图片盖满舞台、按比例缩放（object-fit: contain）：点在图片画面上不关，点在四周空白处关
        const img = e.currentTarget.querySelector<HTMLImageElement>('.lightbox-img');
        if (img && img.naturalWidth && insideContent(img, e.clientX, e.clientY)) return;
        onBackdrop();
      }}
      onTouchStart={(e) => {
        const t = e.touches[0];
        touch.current = t && e.touches.length === 1 ? { x: t.clientX, y: t.clientY } : null;
      }}
      onTouchEnd={(e) => {
        const s = touch.current;
        const t = e.changedTouches[0];
        touch.current = null;
        if (!s || !t || !onSwipe) return;
        const dx = t.clientX - s.x;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(t.clientY - s.y) * 1.5) onSwipe(dx < 0 ? 1 : -1);
      }}
    >
      {src ? (
        <img className="lightbox-img" src={src} alt={a.file_name} draggable={false} />
      ) : (
        <span className="lightbox-missing">{src === null ? tr('图片还没传上来') : tr('正在载入…')}</span>
      )}
      {/* 原图在后面悄悄载入，到了再换（先看到缩略图） */}
      {full && full !== src && <img hidden src={full} alt="" onLoad={() => setLoaded(true)} />}
    </div>
  );
}
