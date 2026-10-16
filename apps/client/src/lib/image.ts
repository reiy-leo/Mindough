/**
 * 图片统一宽高（Rei 2026-10-16：「上传前要统一宽高」）。
 * 资料图按类型版式裁成固定尺寸，居中裁切（和资料库里 object-fit: cover 的显示一致），存 WebP（浏览器不会编 WebP 时退回 JPEG / PNG）：
 * - 竖版海报 2:3 → 600×900
 * - 方形、圆形（含人物头像）→ 600×600
 * - 横幅 16:9 → 1280×720
 * 没有形状的图（任务里的「图片」字段）不裁，只把长边缩到 1600 以内。
 * 解码不了（比如浏览器不认的格式）就原样返回，不挡上传。
 */
import type { TaskType } from '@mindough/core';
import { isPersonLibrary } from '@mindough/core';

export type ArtShape = 'poster' | 'square' | 'banner' | 'round';

/** 类型版式 → 图片形状：海报竖版、图标方形、横幅、人物圆形。 */
export function artShape(type: Pick<TaskType, 'layout' | 'fields'> | null | undefined): ArtShape {
  if (!type) return 'square';
  if (isPersonLibrary(type)) return 'round';
  return layoutShape(type.layout);
}

/** 版式 → 图的形状：竖版海报 2:3、横幅 16:9、圆形，其余方形。 */
export function layoutShape(layout: string): ArtShape {
  return layout === 'poster' ? 'poster' : layout === 'banner' ? 'banner' : layout === 'round' ? 'round' : 'square';
}

export const SHAPE_SIZE: Record<ArtShape, readonly [number, number]> = {
  poster: [600, 900],
  square: [600, 600],
  round: [600, 600],
  banner: [1280, 720],
};

export const MAX_FREE_SIDE = 1600;

export interface Box {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dw: number;
  dh: number;
}

/** 从 w×h 的原图里取哪一块、画成多大。有形状：居中裁成目标比例再缩放；没形状：不裁，长边超过 1600 才缩。 */
export function fitBox(w: number, h: number, shape: ArtShape | null): Box {
  if (!shape) {
    const k = Math.min(1, MAX_FREE_SIDE / Math.max(w, h));
    return { sx: 0, sy: 0, sw: w, sh: h, dw: Math.max(1, Math.round(w * k)), dh: Math.max(1, Math.round(h * k)) };
  }
  const [dw, dh] = SHAPE_SIZE[shape];
  const want = dw / dh;
  let sw = w;
  let sh = h;
  if (w / h > want) sw = h * want;
  else sh = w / want;
  return { sx: (w - sw) / 2, sy: (h - sh) / 2, sw, sh, dw, dh };
}

const canEncode = (b: Blob | null, mime: string) => !!b && b.type === mime && b.size > 0;

function toBlob(canvas: HTMLCanvasElement | OffscreenCanvas, mime: string, quality: number): Promise<Blob | null> {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type: mime, quality }).catch(() => null);
  return new Promise((resolve) => (canvas as HTMLCanvasElement).toBlob((b) => resolve(b), mime, quality));
}

/** 按形状统一宽高，返回新图（失败返回原图）。width/height 是结果尺寸（原样返回时为 null）。 */
export async function normalizeImage(file: Blob, shape: ArtShape | null): Promise<{ blob: Blob; width: number | null; height: number | null }> {
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml' || typeof createImageBitmap !== 'function') return { blob: file, width: null, height: null };
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return { blob: file, width: null, height: null };
  }
  try {
    const box = fitBox(bmp.width, bmp.height, shape);
    // 没形状、也不用缩：原样存，免得白白重新压缩
    if (!shape && box.dw === bmp.width && box.dh === bmp.height) return { blob: file, width: bmp.width, height: bmp.height };
    const canvas: HTMLCanvasElement | OffscreenCanvas =
      typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(box.dw, box.dh) : Object.assign(document.createElement('canvas'), { width: box.dw, height: box.dh });
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) return { blob: file, width: null, height: null };
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, box.sx, box.sy, box.sw, box.sh, 0, 0, box.dw, box.dh);
    let out = await toBlob(canvas, 'image/webp', 0.85);
    if (!canEncode(out, 'image/webp')) {
      // Safari 等编不了 WebP：可能透明的（png / gif / webp）存 PNG，其余 JPEG
      const alpha = /^image\/(png|gif|webp|avif)$/.test(file.type);
      const mime = alpha ? 'image/png' : 'image/jpeg';
      out = await toBlob(canvas, mime, 0.88);
      if (!canEncode(out, mime)) return { blob: file, width: null, height: null };
    }
    return { blob: out!, width: box.dw, height: box.dh };
  } finally {
    bmp.close();
  }
}
