/**
 * 编辑器用到的 Tiptap 扩展（Rei 2026-10-25 换成 Tiptap）。全部是开源扩展（StarterKit 里的那些单独引、表格、图片），没用付费的 Pro 扩展；
 * 公式、提示块、折叠块、脚注、HTML 片段、链接是自己写的（gh-syntax.ts、details.ts、这里）。
 * 不直接用 StarterKit：它会把用不上的 Underline、官方 Link（连带 linkifyjs）一起打进包里，链接的行为我们全是自己的。
 *
 * 节点名用 Tiptap 自己的（paragraph、bulletList、listItem、codeBlock、hardBreak、table、tableRow…）；
 * 自己写的沿用以前的名字（gh_alert、math_inline、math_block、details、details_summary、footnote_reference、footnote_definition、html）。
 * 和 Milkdown 一样的地方：
 * - 一种列表项 listItem，`checked` 不是 null 就是清单项（`- [ ]`），所以一个列表里可以混着写；
 * - 单换行读成 hardBreak（isInline），显示成空格、写回还是换行；Shift+Enter 是真的换行（写成 `\`）；
 * - 粗体 / 强调记下原来的符号（`*` / `_`），表格格子里只有一段；
 * - 快捷键和以前一样（删除线 ⌘⌥X、列表 ⌘⌥8 / ⌘⌥7、代码块 ⌘⌥C、引用 ⌘⇧B、标题 ⌘⌥1–6），不多占别的键。
 */
import { Extension, Mark, Node, markInputRule, mergeAttributes, type AnyExtension } from '@tiptap/core';
import { Document } from '@tiptap/extension-document';
import { Paragraph } from '@tiptap/extension-paragraph';
import { Text } from '@tiptap/extension-text';
import { Heading } from '@tiptap/extension-heading';
import { Blockquote } from '@tiptap/extension-blockquote';
import { HorizontalRule } from '@tiptap/extension-horizontal-rule';
import { Dropcursor, Gapcursor, UndoRedo } from '@tiptap/extensions';
import { Bold, starInputRegex as boldStar, underscoreInputRegex as boldUnderscore } from '@tiptap/extension-bold';
import { Italic, starInputRegex as italicStar, underscoreInputRegex as italicUnderscore } from '@tiptap/extension-italic';
import { Strike } from '@tiptap/extension-strike';
import { HardBreak } from '@tiptap/extension-hard-break';
import { CodeBlock } from '@tiptap/extension-code-block';
import { Code } from '@tiptap/extension-code';
import { BulletList, ListItem, ListKeymap, OrderedList } from '@tiptap/extension-list';
import { Image } from '@tiptap/extension-image';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import { InputRule, inputRules } from '@tiptap/pm/inputrules';
import { liftListItem, sinkListItem } from '@tiptap/pm/schema-list';
import { goToNextCell } from '@tiptap/pm/tables';
import { DOMParser as PMDOMParser, DOMSerializer, Fragment, Slice, type Node as PMNode, type NodeType, type Schema } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { isRemoteImage, remoteImageText } from '../../lib/remote-image';
import { ghExtensions } from './gh-syntax';
import { detailsExtensions } from './details';
import type { MarkdownIO } from './markdown';

// ───────── 链接的小工具（MdEditor 和测试也用）─────────

/** 文档里的一段链接：[from, to) 与地址。 */
export interface LinkRange {
  from: number;
  to: number;
  href: string;
}

/** 网址缺协议时补 https://（mailto: 之类有协议的照原样）。 */
export const withProtocol = (url: string) => (/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`);

/** 手打的 [文字](网址) / [](网址)；前面是 ! 的是图片，不管。也认全角括号（中文输入法）。 */
export const LINK_INPUT_RE = /(?<!!)\[([^\]]*)\][(（]([^)）\s]+)[)）]$/;
/** 手打 <网址> / <mailto:…>：打完 > 变成链接。 */
export const ANGLE_LINK_RE = /<((?:https?:\/\/|mailto:)[^\s<>]+)>$/;
/** 手打裸网址后接空格：网址变成链接（GFM 自动链接，同粘贴 / 读入时的样子）。末尾的标点不算网址。 */
export const BARE_URL_RE = /(?:^|[\s(（])((?:https?:\/\/|www\.)[^\s<>]*[^\s<>.,;:!?'"）)\]】，。；：！？、])[.,;:!?'"）)\]】，。；：！？、]*\s$/;
/** 一行 |a|b|（至少两列，或一列也行）：回车变成表格，这行当表头。 */
export const TABLE_ROW_RE = /^\|(?:[^|]*\|)+\s*$/;

/** 把一行 |a|b| 拆成单元格文字。 */
export function tableCells(line: string): string[] | null {
  const t = line.trim();
  if (!TABLE_ROW_RE.test(t)) return null;
  const cells = t.slice(1, -1).split('|').map((c) => c.trim());
  // |---|---| 这种是分隔行，不当表头
  if (cells.every((c) => /^:?-+:?$/.test(c))) return null;
  return cells;
}

// ───────── 节点 / mark ─────────

/** 粗体 / 强调：记下原来的符号（* 或 _），不画在页面上。 */
const markerAttr = { marker: { default: '*', rendered: false } };

const MdBold = Bold.extend({
  addAttributes: () => markerAttr,
  addInputRules() {
    return [markInputRule({ find: boldStar, type: this.type }), markInputRule({ find: boldUnderscore, type: this.type, getAttributes: { marker: '_' } })];
  },
});
const MdItalic = Italic.extend({
  addAttributes: () => markerAttr,
  addInputRules() {
    return [markInputRule({ find: italicStar, type: this.type }), markInputRule({ find: italicUnderscore, type: this.type, getAttributes: { marker: '_' } })];
  },
});

const MdStrike = Strike.extend({
  addKeyboardShortcuts() {
    return { 'Mod-Alt-x': () => this.editor.commands.toggleStrike() };
  },
});

/** 单换行（isInline）显示成一个空格；Shift+Enter 才是真的换行。表格里不换行，代码块里换成 \n。 */
/** 行内代码外面可以再套粗体 / 链接（`**\`x\`**`），和 markdown 一样；Tiptap 默认不让。 */
const MdCode = Code.extend({ excludes: '' });

const MdHardBreak = HardBreak.extend({
  addAttributes: () => ({ isInline: { default: false, rendered: false } }),
  renderHTML({ node }) {
    return node.attrs.isInline ? ['span', { 'data-type': 'hardbreak', 'data-is-inline': 'true' }, ' '] : ['br', { 'data-type': 'hardbreak' }];
  },
  addKeyboardShortcuts() {
    return {
      'Shift-Enter': () => {
        const { $from } = this.editor.state.selection;
        for (let d = $from.depth; d > 0; d--) {
          const name = $from.node(d).type.name;
          if (name === 'table') return true;
          if (name === 'codeBlock') return this.editor.commands.insertContent('\n');
        }
        return this.editor.commands.setHardBreak();
      },
    };
  },
});

const MdCodeBlock = CodeBlock.extend({
  addAttributes() {
    return { language: { default: '', rendered: false } };
  },
  renderHTML({ node }) {
    const lang = String(node.attrs.language ?? '');
    return ['pre', lang ? { 'data-language': lang } : {}, ['code', lang ? { class: `language-${lang}` } : {}, 0]];
  },
});

const MdBulletList = BulletList.extend({
  addAttributes: () => ({ spread: { default: false, rendered: false } }),
  renderHTML({ node, HTMLAttributes }) {
    return ['ul', mergeAttributes(HTMLAttributes, { 'data-spread': String(node.attrs.spread) }), 0];
  },
  addKeyboardShortcuts() {
    return { 'Mod-Alt-8': () => this.editor.commands.toggleBulletList() };
  },
});

const MdOrderedList = OrderedList.extend({
  addAttributes() {
    return { start: { default: 1, rendered: false }, spread: { default: true, rendered: false } };
  },
  renderHTML({ node }) {
    return ['ol', { ...(node.attrs.start === 1 ? {} : { start: node.attrs.start }), 'data-spread': String(node.attrs.spread) }, 0];
  },
  addKeyboardShortcuts() {
    return { 'Mod-Alt-7': () => this.editor.commands.toggleOrderedList() };
  },
});

/** 列表项：checked 不是 null 就是清单项（勾画在 ::before 上，点它切换，见 taskToggle）。 */
const MdListItem = ListItem.extend({
  addAttributes() {
    return {
      label: { default: '•', rendered: false },
      listType: { default: 'bullet', rendered: false },
      spread: { default: true, rendered: false },
      checked: { default: null, rendered: false },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'li',
        getAttrs: (dom) => {
          const el = dom as HTMLElement;
          const c = el.dataset.checked;
          return { label: el.dataset.label ?? '•', listType: el.dataset.listType ?? 'bullet', spread: el.dataset.spread === 'true', checked: c === 'true' ? true : c === 'false' ? false : null };
        },
      },
    ];
  },
  renderHTML({ node }) {
    const a = node.attrs;
    const base = { 'data-label': a.label, 'data-list-type': a.listType, 'data-spread': String(a.spread) };
    return ['li', a.checked == null ? base : { 'data-item-type': 'task', ...base, 'data-checked': String(a.checked) }, 0];
  },
  addKeyboardShortcuts() {
    return {
      // 清单项里回车：新的一项还是没勾的清单项
      Enter: () => {
        const { $from } = this.editor.state.selection;
        for (let d = $from.depth; d > 0; d--) {
          const n = $from.node(d);
          if (n.type.name === this.name) return this.editor.commands.splitListItem(this.name, n.attrs.checked != null ? { checked: false } : {});
        }
        return false;
      },
      // Tab / Shift+Tab 在 editorKeys 里统一处理
    };
  },
});

/** 网络图片不加载，显示成文字（判断见 lib/remote-image.ts）；自己的图（data:、/api/assets/）照常。 */
const MdImage = Image.extend({
  // 手打 ![…](…) 不变成图片（和以前一样，留着原文）
  addInputRules: () => [],
  addAttributes() {
    // 网络图片显示成 span（见 renderHTML），地址在 data-*；两种都认
    const read = (k: string) => (el: HTMLElement) => el.getAttribute(`data-${k}`) ?? el.getAttribute(k) ?? '';
    return {
      src: { default: '', rendered: false, parseHTML: read('src') },
      alt: { default: '', rendered: false, parseHTML: read('alt') },
      title: { default: '', rendered: false, parseHTML: read('title') },
    };
  },
  parseHTML() {
    return [{ tag: 'img[src]' }, { tag: 'span.md-remote-image[data-src]' }];
  },
  renderHTML({ node }) {
    const src = String(node.attrs.src ?? '');
    const alt = String(node.attrs.alt ?? '');
    // 网络图片：连 <img> 都不建（复制、拖动时也不会去拉图），地址放在 data-src 里，粘回来还是图片
    if (isRemoteImage(src)) return ['span', { class: 'md-remote-image', title: src, 'data-src': src, 'data-alt': alt, 'data-title': String(node.attrs.title ?? '') }, remoteImageText(src, alt)];
    return ['img', { src, ...(node.attrs.alt ? { alt: node.attrs.alt } : {}), ...(node.attrs.title ? { title: node.attrs.title } : {}) }];
  },
  addNodeView() {
    return ({ node }) => {
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
    };
  },
}).configure({ inline: true, allowBase64: true });

const cellContent = { content: 'paragraph' };
const MdTableCell = TableCell.extend(cellContent);
const MdTableHeader = TableHeader.extend(cellContent);
const MdTable = Table.extend({
  // Tab 在 editorKeys 里处理（和以前一样：只在格子间跳，不自动加行）
  addKeyboardShortcuts() {
    const parent = this.parent?.() ?? {};
    const { Tab: _t, 'Shift-Tab': _s, ...rest } = parent as Record<string, () => boolean>;
    return rest;
  },
}).configure({ resizable: false });

/** 段落里的 HTML 片段（`<kbd>`、`<br>`、`<!-- -->`…）：原样留着，显示成源码。 */
export const Html = Node.create({
  name: 'html',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes: () => ({ value: { default: '', rendered: false } }),
  parseHTML: () => [{ tag: 'span[data-type="html"]', getAttrs: (dom) => ({ value: (dom as HTMLElement).dataset.value ?? '' }) }],
  renderHTML: ({ node }) => ['span', { 'data-type': 'html', 'data-value': String(node.attrs.value) }, String(node.attrs.value)],
});

/** 脚注引用 `[^1]`：上标，整个当一个字，不在编辑器里改。 */
export const FootnoteReference = Node.create({
  name: 'footnote_reference',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes: () => ({ label: { default: '', rendered: false } }),
  parseHTML: () => [{ tag: 'sup[data-type="footnote_reference"]', getAttrs: (dom) => ({ label: (dom as HTMLElement).dataset.label ?? '' }) }],
  renderHTML: ({ node }) => ['sup', { 'data-label': String(node.attrs.label), 'data-type': 'footnote_reference' }, String(node.attrs.label)],
});

/** 脚注定义 `[^1]: …`：标号 + 内容。 */
export const FootnoteDefinition = Node.create({
  name: 'footnote_definition',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes: () => ({ label: { default: '', rendered: false } }),
  parseHTML: () => [{ tag: 'dl[data-type="footnote_definition"]', contentElement: 'dd', getAttrs: (dom) => ({ label: (dom as HTMLElement).dataset.label ?? '' }) }],
  renderHTML: ({ node }) => ['dl', { 'data-label': String(node.attrs.label), 'data-type': 'footnote_definition' }, ['dt', { contenteditable: 'false' }, String(node.attrs.label)], ['dd', 0]],
});

/** 不收的链接地址（和以前的编辑器一样挡掉能跑脚本的）。 */
const unsafeHref = (href: string) => /^\s*(javascript|vbscript|data):/i.test(href);

/** 链接：只有 href / title（就是 markdown 里那两样）。点开、悬停浮层、手打转换都在 behaviorExtension。 */
export const Link = Mark.create({
  name: 'link',
  priority: 1000,
  keepOnSplit: false,
  exitable: true,
  inclusive: false,
  addAttributes: () => ({ href: { default: null, rendered: false }, title: { default: null, rendered: false } }),
  parseHTML: () => [{ tag: 'a[href]', getAttrs: (dom) => ({ href: (dom as HTMLElement).getAttribute('href'), title: (dom as HTMLElement).getAttribute('title') }) }],
  renderHTML: ({ mark }) => {
    const href = String(mark.attrs.href ?? '');
    return ['a', { href: unsafeHref(href) ? '' : href, ...(mark.attrs.title ? { title: mark.attrs.title } : {}) }, 0];
  },
});

/** 组成文档结构的扩展（schema）。测试和 getSchema 也用它。 */
export function schemaExtensions(): AnyExtension[] {
  return [
    Document,
    Paragraph,
    Text,
    Heading.configure({ levels: [1, 2, 3, 4, 5, 6] }),
    Blockquote,
    HorizontalRule,
    MdBold,
    MdItalic,
    MdStrike,
    MdCode,
    MdHardBreak,
    MdCodeBlock.configure({ enableTabIndentation: false }),
    MdBulletList,
    MdOrderedList,
    MdListItem,
    ListKeymap,
    Link,
    MdImage,
    MdTable,
    TableRow,
    MdTableHeader,
    MdTableCell,
    Html,
    FootnoteReference,
    FootnoteDefinition,
    ...ghExtensions,
    ...detailsExtensions,
    UndoRedo,
    Dropcursor.configure({ color: 'var(--accent)', width: 2 }),
    Gapcursor,
  ];
}

// ───────── 行为 ─────────

export interface BehaviorOptions {
  placeholder: () => string;
  onEscape?: () => void;
  onLinkShortcut?: () => void;
  /** 鼠标移到链接上（range）/ 移开（null）。 */
  onLinkHover?: (link: LinkRange | null, el: HTMLElement | null) => void;
  /** 点了链接：打开它。 */
  onLinkOpen?: (href: string) => void;
  /** 粘贴 / 拖进来的图片：上传，返回地址；null = 没传成（外面已经提示过）。 */
  uploadImage?: (file: File) => Promise<string | null>;
  /** 拿 markdown 读写（粘贴 markdown、复制成 markdown）。 */
  io: () => MarkdownIO;
}

/**
 * pos 所在那段链接（同一个 link mark 连着的几个文字节点合成一段）。
 * strict：空光标只认在链接里面（不含两端）；inclusive 用于鼠标指着的那个字。
 */
export function linkRangeAt(doc: PMNode, pos: number, strict = true): LinkRange | null {
  const type = doc.type.schema.marks.link;
  if (!type) return null;
  const $pos = doc.resolve(pos);
  const parent = $pos.parent;
  if (!parent.inlineContent) return null;
  const start = $pos.start();
  type Run = { from: number; to: number; mark: import('@tiptap/pm/model').Mark };
  const runs: Run[] = [];
  parent.forEach((child, off) => {
    const m = type.isInSet(child.marks);
    const from = start + off;
    const to = from + child.nodeSize;
    const last = runs[runs.length - 1];
    if (m && last && last.to === from && last.mark.eq(m)) last.to = to;
    else if (m) runs.push({ from, to, mark: m });
  });
  const hit = runs.find((r) => (strict ? r.from < pos && pos < r.to : r.from <= pos && pos <= r.to));
  return hit ? { from: hit.from, to: hit.to, href: String(hit.mark.attrs.href ?? '') } : null;
}

const placeholderKey = new PluginKey('md-placeholder');

/** 光标处能不能加链接：不在代码块、行内代码、已有链接里。 */
const canLinkAt = (state: EditorState, pos: number) => {
  const $s = state.doc.resolve(pos);
  if ($s.parent.type.spec.code) return false;
  return !$s.marks().some((m) => m.type.name === 'code' || m.type.name === 'link');
};

/** 手打 [文字](网址)、<网址>、裸网址 + 空格、|3x2| + 空格。 */
function syntaxRules(): InputRule[] {
  return [
    new InputRule(LINK_INPUT_RE, (state, match, start, end) => {
      const type = state.schema.marks.link;
      const raw = match[2];
      if (!type || !raw) return null;
      const href = withProtocol(raw);
      const text = match[1] || raw;
      const $s = state.doc.resolve(start);
      if ($s.parent.type.spec.code || $s.marks().some((m) => m.type.name === 'code')) return null;
      const marks = $s.marks().filter((m) => m.type !== type);
      // end 是触发前的位置：最后那个右括号还没进文档，一起替换掉
      return state.tr.replaceWith(start, end, state.schema.text(text, [...marks, type.create({ href })])).removeStoredMark(type);
    }),
    new InputRule(ANGLE_LINK_RE, (state, match, start, end) => {
      const type = state.schema.marks.link;
      const url = match[1];
      if (!type || !url || !canLinkAt(state, start)) return null;
      const marks = state.doc.resolve(start).marks();
      return state.tr.replaceWith(start, end, state.schema.text(url, [...marks, type.create({ href: url })])).removeStoredMark(type);
    }),
    new InputRule(BARE_URL_RE, (state, match, start, end) => {
      const type = state.schema.marks.link;
      const url = match[1];
      if (!type || !url) return null;
      const from = start + match[0].lastIndexOf(url);
      const to = from + url.length;
      if (!canLinkAt(state, from) || state.doc.rangeHasMark(from, to, type)) return null;
      const href = url.startsWith('www.') ? `https://${url}` : url;
      // 补上触发的那个空格（input rule 接管了这次输入）
      return state.tr.addMark(from, to, type.create({ href })).insertText(match[0].slice(-1), end).removeStoredMark(type);
    }),
    // |3x2| 空格：3 列 2 行的表格（第一行是表头），光标进第一格（Milkdown 原有的写法）
    new InputRule(/^\|(\d+)[xX](\d+)\|\s$/, (state, match, start, end) => {
      const cols = Math.min(20, Math.max(1, Number(match[1])));
      const rows = Math.min(50, Math.max(1, Number(match[2])));
      const $s = state.doc.resolve(start);
      if ($s.parent.type.name !== 'paragraph' || $s.depth !== 1 || $s.parent.content.size !== end - $s.start()) return null;
      const table = makeTable(state.schema, Array.from({ length: cols }, () => ''), rows);
      if (!table) return null;
      const tr = state.tr.replaceWith($s.before(), $s.after(), table);
      return tr.setSelection(TextSelection.create(tr.doc, $s.before() + 4));
    }),
  ];
}

/** 一个表格：第一行是表头（header 里的字），后面 rows - 1 行空的（至少一行）。 */
function makeTable(schema: Schema, header: string[], rows: number): PMNode | null {
  const n = schema.nodes;
  if (!n.table || !n.tableRow || !n.tableHeader || !n.tableCell || !n.paragraph) return null;
  const cell = (type: NodeType, text: string) => type.create({ align: null }, n.paragraph!.create(null, text ? schema.text(text) : null));
  const body = Array.from({ length: Math.max(1, rows - 1) }, () => n.tableRow!.create(null, header.map(() => cell(n.tableCell!, ''))));
  return n.table.create(null, [n.tableRow.create(null, header.map((c) => cell(n.tableHeader!, c))), ...body]);
}

/** 点清单项左边的勾：切换完成。 */
function taskToggle() {
  return new Plugin({
    props: {
      handleDOMEvents: {
        mousedown(view, event) {
          if (!view.editable) return false;
          const li = (event.target as HTMLElement).closest?.('li[data-item-type="task"]') as HTMLElement | null;
          if (!li || !view.dom.contains(li)) return false;
          const rect = li.getBoundingClientRect();
          if (event.clientX - rect.left > 26) return false; // 只在勾的位置
          const pos = view.posAtDOM(li, 0);
          const $pos = view.state.doc.resolve(pos);
          for (let d = $pos.depth; d >= 0; d--) {
            const node = $pos.node(d);
            if (node.type.name === 'listItem' && node.attrs.checked != null) {
              event.preventDefault();
              view.dispatch(view.state.tr.setNodeMarkup($pos.before(d), undefined, { ...node.attrs, checked: !node.attrs.checked }));
              return true;
            }
          }
          return false;
        },
      },
    },
  });
}

/** 编辑器里的链接：点一下打开（mousedown 不放光标、不进编辑），鼠标移上 / 移开通知外面。 */
function linkPointer(opts: BehaviorOptions) {
  const linkOf = (view: EditorView, t: EventTarget | null) => {
    const a = (t as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    return a && view.dom.contains(a) ? a : null;
  };
  return new Plugin({
    props: {
      handleDOMEvents: {
        mousedown(view, event) {
          if (!linkOf(view, event.target) || event.button !== 0 || !opts.onLinkOpen) return false;
          event.preventDefault();
          return true;
        },
        click(view, event) {
          const a = linkOf(view, event.target);
          if (!a || event.button !== 0 || !opts.onLinkOpen) return false;
          event.preventDefault();
          const href = a.getAttribute('href') ?? '';
          if (href) opts.onLinkOpen(href);
          return true;
        },
        mouseover(view, event) {
          const a = linkOf(view, event.target);
          if (!a || !opts.onLinkHover) return false;
          let pos: number;
          try {
            pos = view.posAtDOM(a, 0);
          } catch {
            return false;
          }
          const doc = view.state.doc;
          const r = linkRangeAt(doc, Math.min(pos + 1, doc.content.size), false) ?? linkRangeAt(doc, pos, false);
          opts.onLinkHover(r, a);
          return false;
        },
        mouseout(view, event) {
          const a = linkOf(view, event.target);
          const to = event.relatedTarget as HTMLElement | null;
          if (!a || !opts.onLinkHover || (to && a.contains(to))) return false;
          opts.onLinkHover(null, null);
          return false;
        },
      },
    },
  });
}

/** 一行 |a|b| 回车：变成表格（这行是表头，下面一行空的），光标进第一格。 */
function tableOnEnter(view: EditorView, event: KeyboardEvent): boolean {
  if (event.key !== 'Enter' || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return false;
  const { state } = view;
  const { $from, empty } = state.selection;
  const para = $from.parent;
  if (!empty || para.type.name !== 'paragraph' || $from.parentOffset !== para.content.size) return false;
  // 只在文档顶层（不在列表、引用、表格里）
  if ($from.depth !== 1) return false;
  const cells = tableCells(para.textContent);
  if (!cells || !cells.length) return false;
  const table = makeTable(state.schema, cells, 2);
  if (!table) return false;
  const before = $from.before();
  const tr = state.tr.replaceWith(before, $from.after(), table);
  // 第一行数据的第一格：table(1) + 表头行 + row(1) + cell(1) + paragraph(1)
  tr.setSelection(TextSelection.create(tr.doc, before + 1 + table.child(0).nodeSize + 3));
  view.dispatch(tr.scrollIntoView());
  event.preventDefault();
  return true;
}

/** Tab / Shift+Tab：列表缩进、表格跳格、代码块插两个空格；别的情况也吃掉，免得焦点跑出编辑器。 */
function handleTab(view: EditorView, event: KeyboardEvent): boolean {
  if (event.key !== 'Tab' || event.metaKey || event.ctrlKey || event.altKey) return false;
  event.preventDefault();
  const { state } = view;
  const { $from } = state.selection;
  const dispatch = view.dispatch.bind(view);
  const inside = (name: string) => {
    for (let d = $from.depth; d > 0; d--) if ($from.node(d).type.name === name) return true;
    return false;
  };
  if ($from.parent.type.spec.code) {
    if (!event.shiftKey) dispatch(state.tr.insertText('  ').scrollIntoView());
  } else if (inside('tableCell') || inside('tableHeader')) {
    goToNextCell(event.shiftKey ? -1 : 1)(state, dispatch);
  } else {
    const li = state.schema.nodes.listItem;
    if (li && inside('listItem')) (event.shiftKey ? liftListItem(li) : sinkListItem(li))(state, dispatch);
  }
  view.focus();
  return true;
}

/** 正在上传的图片：在落点放一个「正在上传」的小标记，传完换成图片。 */
const uploadKey = new PluginKey<DecorationSet>('md-image-upload');

function uploadPlugin(opts: BehaviorOptions) {
  return new Plugin<DecorationSet>({
    key: uploadKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, set) {
        let s = set.map(tr.mapping, tr.doc);
        const meta = tr.getMeta(uploadKey) as { add?: { id: string; pos: number }; remove?: string } | undefined;
        if (meta?.add) {
          const el = document.createElement('span');
          el.className = 'md-image-uploading';
          el.textContent = '…';
          s = s.add(tr.doc, [Decoration.widget(meta.add.pos, el, { id: meta.add.id })]);
        }
        if (meta?.remove) s = s.remove(s.find(undefined, undefined, (spec) => spec.id === meta.remove));
        return s;
      },
    },
    props: {
      decorations: (state) => uploadKey.getState(state),
      handlePaste(view, event) {
        const files = imageFiles(event.clipboardData);
        if (!files.length || !opts.uploadImage || !view.editable) return false;
        event.preventDefault();
        void insertImages(view, files, view.state.selection.from, opts);
        return true;
      },
      handleDrop(view, event) {
        const files = imageFiles(event.dataTransfer);
        if (!files.length || !opts.uploadImage || !view.editable) return false;
        event.preventDefault();
        const at = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? view.state.selection.from;
        void insertImages(view, files, at, opts);
        return true;
      },
    },
  });
}

/** 剪贴板 / 拖进来的东西里的图片文件（只有图片才算；混着别的文件的整批交给附件）。 */
export function imageFiles(data: DataTransfer | null): File[] {
  if (!data) return [];
  const files = [...(data.files ?? [])];
  if (!files.length || !files.every((f) => f.type.startsWith('image/'))) return [];
  return files;
}

let uploadSeq = 0;
async function insertImages(view: EditorView, files: File[], pos: number, opts: BehaviorOptions) {
  for (const file of files) {
    const id = `up${++uploadSeq}`;
    view.dispatch(view.state.tr.setMeta(uploadKey, { add: { id, pos } }).setMeta('addToHistory', false));
    let url: string | null = null;
    try {
      url = await opts.uploadImage!(file);
    } catch (err) {
      console.error('图片上传失败', err);
    }
    if ((view as unknown as { isDestroyed?: boolean }).isDestroyed || !view.dom.isConnected) return;
    const found = uploadKey.getState(view.state)?.find(undefined, undefined, (spec) => spec.id === id)[0];
    const at = found ? found.from : pos;
    const tr = view.state.tr.setMeta(uploadKey, { remove: id });
    const image = view.state.schema.nodes.image;
    if (url && image) {
      const node = image.create({ src: url, alt: '', title: '' });
      const $at = tr.doc.resolve(Math.min(at, tr.doc.content.size));
      if ($at.parent.inlineContent) tr.insert($at.pos, node);
      else tr.insert($at.pos, view.state.schema.nodes.paragraph!.create(null, node));
      pos = tr.mapping.map(at) + 1;
    }
    view.dispatch(tr);
  }
}

/** 粘贴纯文字：当 markdown 读（和以前一样）；复制出去：写成 markdown。网络图片不加载（在不挂页面的文档里转换）。 */
function markdownClipboard(opts: BehaviorOptions) {
  return new Plugin({
    props: {
      handlePaste(view, event) {
        const data = event.clipboardData;
        if (!data || !view.editable) return false;
        if (view.state.selection.$from.parent.type.spec.code) return false;
        const text = data.getData('text/plain');
        const vscode = data.getData('vscode-editor-data');
        if (vscode && text) {
          let lang = '';
          try {
            lang = String((JSON.parse(vscode) as { mode?: string }).mode ?? '');
          } catch {
            /* 不是 JSON：当普通文字 */
          }
          const code = view.state.schema.nodes.codeBlock;
          if (lang && code) {
            view.dispatch(view.state.tr.replaceSelectionWith(code.create({ language: lang }, view.state.schema.text(text))).scrollIntoView());
            return true;
          }
        }
        if (data.getData('text/html') || !text) return false;
        let doc: PMNode;
        try {
          doc = opts.io().parse(text);
        } catch {
          return false;
        }
        const schema = view.state.schema;
        const detached = document.implementation.createHTMLDocument('');
        const wrap = detached.createElement('div');
        wrap.appendChild(DOMSerializer.fromSchema(schema).serializeFragment(doc.content, { document: detached }));
        const slice = PMDOMParser.fromSchema(schema).parseSlice(wrap, { preserveWhitespace: true });
        const single = slice.content.childCount === 1 && slice.content.firstChild?.type.name === 'paragraph' ? slice.content.firstChild : null;
        try {
          if (single && slice.openStart >= 1) view.dispatch(view.state.tr.replaceSelection(new Slice(Fragment.from(single), 1, 1)).scrollIntoView());
          else view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView());
          return true;
        } catch {
          return false;
        }
      },
      clipboardTextSerializer(slice) {
        try {
          const doc = slice.content.firstChild?.isInline ? null : opts.io();
          if (!doc) return slice.content.textBetween(0, slice.content.size, '\n\n');
          const schema = slice.content.firstChild!.type.schema;
          const top = schema.topNodeType.createAndFill(undefined, slice.content);
          return top ? doc.serialize(top) : slice.content.textBetween(0, slice.content.size, '\n\n');
        } catch {
          return slice.content.textBetween(0, slice.content.size, '\n\n');
        }
      },
    },
  });
}

/** 编辑器的行为扩展：占位、清单勾、链接、手打语法、Tab / Esc / ⌘K、图片上传、剪贴板。优先级高于 StarterKit。 */
export function behaviorExtension(opts: BehaviorOptions) {
  return Extension.create({
    name: 'mindoughBehavior',
    priority: 1000,
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: placeholderKey,
          props: {
            // 文档只有一个空段落时显示占位文字
            decorations(state) {
              const doc = state.doc;
              const first = doc.firstChild;
              if (doc.childCount !== 1 || !first || !first.isTextblock || first.content.size > 0) return null;
              return DecorationSet.create(doc, [Decoration.node(0, first.nodeSize, { class: 'md-placeholder', 'data-placeholder': opts.placeholder() })]);
            },
            handleKeyDown(view, event) {
              if (event.key === 'Tab') return handleTab(view, event);
              if (event.key === 'Escape' && opts.onEscape) {
                event.preventDefault();
                event.stopPropagation();
                opts.onEscape();
                return true;
              }
              if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'k' && opts.onLinkShortcut) {
                event.preventDefault();
                event.stopPropagation();
                opts.onLinkShortcut();
                return true;
              }
              return tableOnEnter(view, event);
            },
          },
        }),
        uploadPlugin(opts),
        markdownClipboard(opts),
        taskToggle(),
        linkPointer(opts),
        inputRules({ rules: syntaxRules() }),
        // 清单：列表项开头打 [ ] / [x] 再空格
        inputRules({
          rules: [
            new InputRule(/^\[([\sxX])\]\s$/, (state, match, start, end) => {
              const $s = state.doc.resolve(start);
              const d = $s.depth;
              if (d < 2 || $s.parent.type.name !== 'paragraph' || $s.index(d - 1) !== 0) return null;
              const li = $s.node(d - 1);
              if (li.type.name !== 'listItem' || li.attrs.checked != null) return null;
              const tr = state.tr.delete(start, end);
              return tr.setNodeMarkup($s.before(d - 1), undefined, { ...li.attrs, checked: match[1]!.toLowerCase() === 'x' });
            }),
          ],
        }),
      ];
    },
  });
}
