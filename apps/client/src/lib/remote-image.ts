/**
 * 正文里的网络图片不渲染（Rei 2026-10-17：「编辑器的网络插图」「编辑器不渲染网络图片」）。
 * markdown 里的 ![alt](https://…) 原样保存、原样写回，只是显示成一段链接样式的文字（alt，没有就显示网址），
 * 不发任何图片请求。自己的图（data: / blob:、Mindough 自己的 /api/assets/…）照常显示。
 * 编辑器（components/editor/remote-image.ts 的 image 节点视图）和只读预览（lib/markdown.ts）共用这里的判断。
 */
import { SERVER_ORIGIN, isOwnOrigin } from './origins';

/** 这张图要不要从网上拉：http(s) 或 // 开头、且不是 Mindough 自己的图片地址。 */
export function isRemoteImage(src: string): boolean {
  const s = src.trim();
  if (!/^(https?:)?\/\//i.test(s)) return false;
  try {
    const u = new URL(s, SERVER_ORIGIN);
    const own = isOwnOrigin(u.origin) || (typeof location !== 'undefined' && u.origin === location.origin);
    return !(own && u.pathname.startsWith('/api/assets/'));
  } catch {
    return true;
  }
}

/** 网络图片显示成的文字：alt，没有就网址。 */
export const remoteImageText = (src: string, alt: string) => alt.trim() || src.trim();

