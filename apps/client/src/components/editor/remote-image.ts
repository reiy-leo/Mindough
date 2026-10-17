/** 编辑器里 image 节点的显示：网络图片不加载（判断见 lib/remote-image.ts），显示成链接样式的文字。 */
import { $prose, $view } from '@milkdown/kit/utils';
import { imageSchema } from '@milkdown/kit/preset/commonmark';
import { parserCtx, schemaCtx } from '@milkdown/kit/core';
import { DOMParser, DOMSerializer, type Node as PMNode } from '@milkdown/kit/prose/model';
import { Plugin } from '@milkdown/kit/prose/state';
import { isRemoteImage, remoteImageText } from '../../lib/remote-image';

/** 编辑器里 image 节点的显示：网络图片 → 链接样式的文字；其余照常 <img>。 */
export const remoteImageView = $view(imageSchema.node, () => (node) => {
  const src = String(node.attrs.src ?? '');
  const alt = String(node.attrs.alt ?? '');
  const title = String(node.attrs.title ?? '');
  if (isRemoteImage(src)) {
    const dom = document.createElement('span');
    dom.className = 'md-remote-image';
    dom.textContent = remoteImageText(src, alt);
    dom.title = src;
    return { dom, ignoreMutation: () => true };
  }
  const dom = document.createElement('img');
  dom.src = src;
  if (alt) dom.alt = alt;
  if (title) dom.title = title;
  return { dom, ignoreMutation: () => true };
});

/**
 * 粘贴纯文字 markdown：Milkdown 的剪贴板插件会先把解析结果序列化成真的 DOM（在当前页面里建 <img>，浏览器就去拉图了）。
 * 带图片的纯文字粘贴由这里先接：同样解析，但序列化到一个不挂页面的文档里（不发请求），再照样插进来。
 * 要放在 clipboard 插件前面 use。
 */
export const remoteImagePaste = $prose((ctx) => {
  const schema = ctx.get(schemaCtx);
  return new Plugin({
    props: {
      handlePaste(view, event) {
        const data = event.clipboardData;
        if (!data || data.getData('text/html') || data.getData('vscode-editor-data')) return false;
        const text = data.getData('text/plain');
        if (!text.includes('![') || view.state.selection.$from.parent.type.spec.code) return false;
        const doc = ctx.get(parserCtx)(text) as PMNode | string;
        if (!doc || typeof doc === 'string') return false;
        const detached = document.implementation.createHTMLDocument('');
        const dom = DOMSerializer.fromSchema(schema).serializeFragment(doc.content, { document: detached });
        const wrap = detached.createElement('div');
        wrap.appendChild(dom);
        const slice = DOMParser.fromSchema(schema).parseSlice(wrap);
        try {
          view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView());
          return true;
        } catch {
          return false;
        }
      },
    },
  });
});
