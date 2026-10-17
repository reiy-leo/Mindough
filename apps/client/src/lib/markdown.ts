/**
 * Markdown → HTML：任务内容、资料 / 人物备注共用。GFM（表格、- [ ] 清单、删除线）+ 换行即换行（老的纯文字备注照原样分行）；
 * 链接一律新标签页打开。markdownHtml 是纯函数（可测）；界面用 renderMarkdown（再过一遍 DOMPurify 消毒）。
 * GitHub 扩展（Rei 2026-10-17）：提示块 `> [!NOTE]`（lib/gh-alerts.ts）、数学公式 `$…$` / `$$…$$` / ```math（lib/math.ts，KaTeX）、
 * 脚注 `[^1]`（marked-footnote）。
 */
import { Marked, type Tokens, type TokenizerAndRendererExtension } from 'marked';
import markedFootnote from 'marked-footnote';
import DOMPurify from 'dompurify';
import { isRemoteImage, remoteImageText } from './remote-image';
import { ALERT_MARKER_RE, alertTitleHtml, type AlertKind } from './gh-alerts';
import { BLOCK_MATH_RE, INLINE_MATH_RE, renderMath, validInlineMath } from './math';
import { getLocale, tr } from './i18n';

const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

interface MathToken {
  type: 'mathInline' | 'mathBlock';
  raw: string;
  text: string;
}

const inlineMath: TokenizerAndRendererExtension = {
  name: 'mathInline',
  level: 'inline',
  start: (src) => {
    const i = src.indexOf('$');
    return i < 0 ? undefined : i;
  },
  tokenizer(src) {
    const m = INLINE_MATH_RE.exec(src);
    if (!m) return undefined;
    const inner = m[2]!;
    // 不像公式（「$5 和 $10」）：这一对 $ 连同中间的字当普通文字吃掉（和编辑器 micromark 的配对一样，后面那个 $ 不再拿去开头）
    if (!validInlineMath(inner, src[m[0].length])) return { type: 'text', raw: m[0], text: m[0], escaped: false } as never;
    return { type: 'mathInline', raw: m[0], text: inner } satisfies MathToken;
  },
  renderer: (t) => renderMath((t as unknown as MathToken).text, false),
};

const blockMath: TokenizerAndRendererExtension = {
  name: 'mathBlock',
  level: 'block',
  start: (src) => {
    const m = /^ {0,3}\$\$/m.exec(src);
    return m ? m.index : undefined;
  },
  tokenizer(src) {
    const m = BLOCK_MATH_RE.exec(src);
    if (!m) return undefined;
    return { type: 'mathBlock', raw: m[0], text: (m[1] ?? m[2] ?? '').trim() } satisfies MathToken;
  },
  renderer: (t) => `<div class="md-math-block">${renderMath((t as unknown as MathToken).text, true)}</div>\n`,
};

/** 引用块第一段以 [!NOTE] 开头：变成提示块（标记那行去掉，换成图标 + 标题）。 */
const ALERT_HTML_RE = /^<p>\\?\[!(note|tip|important|warning|caution)\\?\][ \t]*(?:<br>\n?|\n|(?=<\/p>))/i;

function build() {
  const md = new Marked({
    gfm: true,
    breaks: true,
    extensions: [blockMath, inlineMath],
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
      blockquote(this: { parser: { parse: (t: Tokens.Blockquote['tokens']) => string } }, token: Tokens.Blockquote) {
        if (!ALERT_MARKER_RE.test(token.text)) return false;
        const body = this.parser.parse(token.tokens);
        const m = ALERT_HTML_RE.exec(body);
        if (!m) return false;
        const kind = m[1]!.toLowerCase() as AlertKind;
        const after = body.slice(m[0].length);
        // 标记独占第一段：整段去掉；标记后面还有字：这段留下
        const content = after.startsWith('</p>') ? after.replace(/^<\/p>\n?/, '') : `<p>${after}`;
        return `<div class="md-alert md-alert-${kind}" data-alert="${kind}">${alertTitleHtml(kind)}${content}</div>\n`;
      },
      /** ```math 代码块：块级公式（GitHub 也这样）。 */
      code(token: Tokens.Code) {
        if ((token.lang ?? '').trim().toLowerCase() !== 'math') return false;
        return `<div class="md-math-block">${renderMath(token.text, true)}</div>\n`;
      },
    },
  });
  md.use(markedFootnote({ description: tr('脚注'), backRefLabel: tr('回到引用 {0}'), prefixId: 'md-fn-' }));
  return md;
}

let cached: { locale: string; md: Marked } | null = null;
const instance = () => {
  const locale = getLocale();
  if (!cached || cached.locale !== locale) cached = { locale, md: build() };
  return cached.md;
};

/** 未消毒的 HTML（测试用；界面请用 renderMarkdown）。 */
export function markdownHtml(source: string): string {
  return instance().parse(source, { async: false }) as string;
}

export function renderMarkdown(source: string): string {
  return DOMPurify.sanitize(markdownHtml(source), { ADD_ATTR: ['target'] });
}
