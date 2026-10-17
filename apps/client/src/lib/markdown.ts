/**
 * Markdown → HTML：任务内容、资料 / 人物备注共用。GFM（表格、- [ ] 清单、删除线）+ 换行即换行（老的纯文字备注照原样分行）；
 * 链接一律新标签页打开。markdownHtml 是纯函数（可测）；界面用 renderMarkdown（再过一遍 DOMPurify 消毒）。
 */
import { Marked, type Tokens } from 'marked';
import DOMPurify from 'dompurify';
import { isRemoteImage, remoteImageText } from './remote-image';

const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const md = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    link(this: { parser: { parseInline: (t: Tokens.Link['tokens']) => string } }, token: Tokens.Link) {
      const text = this.parser.parseInline(token.tokens);
      const title = token.title ? ` title="${escAttr(token.title)}"` : '';
      return `<a href="${escAttr(token.href)}"${title} target="_blank" rel="noopener noreferrer">${text}</a>`;
    },
    /** 网络图片不渲染（Rei 2026-10-17），显示成和编辑器一样的文字；自己的图照常。 */
    image(token: Tokens.Image) {
      if (isRemoteImage(token.href)) return `<span class="md-remote-image" title="${escAttr(token.href)}">${escHtml(remoteImageText(token.href, token.text))}</span>`;
      return false;
    },
  },
});

/** 未消毒的 HTML（测试用；界面请用 renderMarkdown）。 */
export function markdownHtml(source: string): string {
  return md.parse(source, { async: false }) as string;
}

export function renderMarkdown(source: string): string {
  return DOMPurify.sanitize(markdownHtml(source), { ADD_ATTR: ['target'] });
}
