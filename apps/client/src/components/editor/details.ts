/**
 * 编辑器里的折叠块（Rei 2026-10-17）：`<details><summary>标题</summary>内容</details>`。存的还是那段 HTML，只读显示本来就能折叠。
 *
 * 读入：remark 把 `<details>` 那段 HTML（一个 html 节点写完，或「开头 html … 中间是普通块 … 结尾 </details>」）收成一个
 *   details 节点：标题（summary 里的文字）+ 正文（普通块，里面还可以再放折叠块 / 列表 / 提示块…）。认不出来的（没有结尾）照旧当 HTML。
 * 编辑器：details 节点 = 折叠三角（不可编辑，点它展开 / 收起）+ 标题（纯文字，一行）+ 正文。
 *   展开 / 收起只是看的状态（attr expanded），不写回 markdown：点开看一眼不该算改了正文（正文按整段后写赢同步，免得白白冲掉另一台的改动）。
 *   原文里的 `open` 属性照原样保留（决定打开时默认展开），界面上不改它。
 * 写出：标准写法——
 *     <details>
 *     <summary>标题</summary>
 *
 *     正文（markdown）
 *
 *     </details>
 *   原文是一行写完、正文只有一段文字的（`<details><summary>标题</summary>内容</details>`），正文还是一段文字时照一行写回去。
 * 输入（没有工具栏了，Rei 2026-10-25）：行首打 `>> `（这行后面的字当标题；空引用里再打 `> ` 也算）；
 *   或者手打一行 `<details>`（可带 open / <summary>标题</summary>）回车。
 * 键：标题里回车 → 进正文第一行（收起的先展开）；标题开头退格 → 拆开（标题变回一段文字）；
 *   收起时 ↓ 跳过正文到下一块，下一块开头 ↑ 回到标题；光标不管怎么进了收起的正文都会自动展开。
 */
import { Extension, InputRule as TiptapInputRule, Node as TiptapNode } from '@tiptap/core';
import { Plugin, PluginKey, Selection, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView, type NodeView } from '@tiptap/pm/view';
import { Fragment, type Node as PMNode } from '@tiptap/pm/model';
import { tr } from '../../lib/i18n';
import { fixInlineMath, liftAlerts } from './gh-syntax';
import type { MdNode, ParseSpec, SerializeSpec } from './markdown';

// ───────── remark：读入 ─────────


/** 收好的折叠块（mdast）。 */
export interface DetailsMd extends MdNode {
  type: 'details';
  /** <details …> 里的属性原文（含前面的空格），如「 open」。 */
  attrs: string;
  summaryAttrs: string;
  summary: string;
  hasSummary: boolean;
  /** 原文一行写完、正文是一段文字。 */
  inline: boolean;
  children: MdNode[];
}

const OPEN_RE = /^<details(\s[^>]*)?>/i;
const SUMMARY_RE = /^\s*<summary(\s[^>]*)?>([\s\S]*?)<\/summary>/i;
const TAG_RE = /<details(?:\s[^>]*)?>|<\/details\s*>/gi;

/** 块级 HTML 已经包进了段落（markdown.ts 的 remarkHtmlTransformer）；两种都认。 */
const htmlOf = (n: MdNode | undefined): string | null => {
  if (!n) return null;
  if (n.type === 'html') return n.value ?? '';
  if (n.type === 'paragraph' && n.children?.length === 1 && n.children[0]!.type === 'html') return n.children[0]!.value ?? '';
  return null;
};

/** 正文里留下的块级 html 也包进段落（编辑器的 html 是行内节点）。 */
const wrapHtml = (n: MdNode): MdNode => (n.type === 'html' ? { type: 'paragraph', children: [n] } : n);

/** 从 depth 层开始数一段 HTML 里的 <details> / </details>：最后的层数；回到 0 层的那个 </details> 的位置（没有是 -1）。 */
function scanTags(s: string, depth: number): { depth: number; closeAt: number; closeEnd: number } {
  TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG_RE.exec(s))) {
    if (m[0][1] === '/') {
      depth--;
      if (depth === 0) return { depth, closeAt: m.index, closeEnd: m.index + m[0].length };
    } else depth++;
  }
  return { depth, closeAt: -1, closeEnd: -1 };
}

export type ParseMd = (src: string) => MdNode[];

/** 把一层里的 <details> 收成 details 节点（递归处理正文和别的容器）。 */
export function liftDetailsIn(children: MdNode[], parse: ParseMd): MdNode[] {
  const out: MdNode[] = [];
  let i = 0;
  while (i < children.length) {
    const c = children[i]!;
    const html = htmlOf(c);
    if (html != null && OPEN_RE.test(html)) {
      const hit = tryLift(children, i, html, parse);
      if (hit) {
        out.push(...hit.nodes);
        i = hit.next;
        continue;
      }
    }
    if (c.children && c.type !== 'paragraph' && c.type !== 'heading' && c.type !== 'tableCell') c.children = liftDetailsIn(c.children, parse);
    out.push(c);
    i++;
  }
  return out;
}

function tryLift(children: MdNode[], i: number, html: string, parse: ParseMd): { nodes: MdNode[]; next: number } | null {
  const open = OPEN_RE.exec(html)!;
  let rest = html.slice(open[0].length);
  const sm = SUMMARY_RE.exec(rest);
  if (sm) rest = rest.slice(sm[0].length);
  const node: DetailsMd = {
    type: 'details',
    attrs: open[1] ?? '',
    summaryAttrs: sm?.[1] ?? '',
    summary: (sm?.[2] ?? '').replace(/\s*\n\s*/g, ' ').trim(),
    hasSummary: !!sm,
    inline: false,
    children: [],
  };
  const sub = (src: string) => (src.trim() ? parse(src) : []);
  const after: MdNode[] = [];
  // 一个 html 节点就写完了（一行写完，或中间没有空行）
  const same = scanTags(rest, 1);
  let next: number;
  if (same.closeAt >= 0) {
    const body = rest.slice(0, same.closeAt);
    node.children = sub(body);
    node.inline = !html.trim().includes('\n') && (node.children.length === 0 || (node.children.length === 1 && node.children[0]!.type === 'paragraph'));
    after.push(...sub(rest.slice(same.closeEnd)));
    next = i + 1;
  } else {
    if (same.depth !== 1) return null; // 开头这段里还套着没关上的 <details>：不认
    // 往后找配对的 </details>（只看 html 节点）
    let depth = 1;
    let j = i + 1;
    let close: { at: number; end: number; html: string } | null = null;
    for (; j < children.length; j++) {
      const h = htmlOf(children[j]);
      if (h == null) continue;
      const r = scanTags(h, depth);
      depth = r.depth;
      if (r.closeAt >= 0) {
        close = { at: r.closeAt, end: r.closeEnd, html: h };
        break;
      }
    }
    if (!close) return null; // 没有结尾：照旧当 HTML
    node.children = [...sub(rest), ...children.slice(i + 1, j), ...sub(close.html.slice(0, close.at))];
    after.push(...sub(close.html.slice(close.end)));
    next = j + 1;
  }
  node.children = liftDetailsIn(node.children, parse).map(wrapHtml);
  return { nodes: [node, ...liftDetailsIn(after, parse).map(wrapHtml)], next };
}

/** remark 插件：放在 gh-syntax 后面（主文档的公式 / 提示块它已经处理过；这里只处理从 HTML 里拆出来重新读的那几段）。 */
export function remarkDetails(this: { parse(src: string): MdNode }) {
  const parse: ParseMd = (src) => {
    const tree = this.parse(src);
    fixInlineMath(tree as never, src);
    liftAlerts(tree as never);
    return tree.children ?? [];
  };
  return (tree: MdNode) => {
    if (tree.children) tree.children = liftDetailsIn(tree.children, parse);
  };
}


// ───────── 节点 ─────────

const isOpenAttr = (attrs: string) => /(^|\s)open(\s|=|$)/i.test(attrs);

/** 折叠块标题：一行纯文字，不带格式（由 details 自己读写）。 */
export const DetailsSummary = TiptapNode.create({
  name: 'details_summary',
  content: 'text*',
  marks: '',
  defining: true,
  isolating: true,
  addAttributes: () => ({ attrs: { default: '', rendered: false } }),
  parseHTML: () => [{ tag: 'summary' }, { tag: 'div.md-details-summary' }],
  renderHTML: () => ['div', { class: 'md-details-summary' }, 0],
});

/** 折叠块：标题 + 正文（block+）。attrs 是 <details …> 里的属性原文；expanded 只是看的状态，不写回 markdown。 */
export const Details = TiptapNode.create({
  name: 'details',
  group: 'block',
  content: 'details_summary block+',
  defining: true,
  addAttributes: () => ({
    attrs: { default: '', rendered: false },
    inline: { default: false, rendered: false },
    hasSummary: { default: true, rendered: false },
    /** 编辑器里展开着没有（不写回 markdown）。 */
    expanded: { default: true, rendered: false },
  }),
  parseHTML: () => [
    { tag: 'details', getAttrs: (dom) => ({ attrs: (dom as HTMLElement).hasAttribute('open') ? ' open' : '', expanded: true }) },
    { tag: 'div[data-type="details"]', contentElement: '.md-details-inner', getAttrs: (dom) => ({ attrs: (dom as HTMLElement).dataset.attrs ?? '', expanded: true }) },
  ],
  renderHTML: ({ node }) => [
    'div',
    { 'data-type': 'details', 'data-attrs': String(node.attrs.attrs ?? ''), class: `md-details${node.attrs.expanded ? ' is-open' : ''}` },
    ['div', { class: 'md-details-inner' }, 0],
  ],
  addNodeView: () => (p) => detailsView(p.node, p.view, p.getPos as () => number | undefined),
  // 比引用（Blockquote，100）先试，「> > 」才轮得到这里
  priority: 101,
  /**
   * 短写法（Rei 2026-10-25 问「collapsible要怎么触发」）：行首打 `>> ` 变成折叠块，这一行后面的字当标题；
   * 先打了 `> ` 变成空引用、再打 `> `，也变成折叠块（不嵌套引用）。引用里已经写了东西，再在某行开头打 `> ` 还是嵌套引用。
   */
  addInputRules() {
    const toDetails = (state: EditorState, from: number, to: number, outer: boolean) => {
      const $s = state.doc.resolve(from);
      const d = outer ? $s.depth - 1 : $s.depth;
      const para = $s.parent;
      const title = para.textBetween(to - $s.start(), para.content.size, '');
      if (outer && (para.textBetween(0, from - $s.start(), '') !== '' || title.includes('\n'))) return null;
      const parent = $s.node(d - 1);
      const idx = $s.index(d - 1);
      if (!parent.canReplaceWith(idx, idx + 1, this.type)) return null;
      const at = $s.before(d);
      const t = state.tr.replaceWith(at, $s.after(d), makeDetails(state, title));
      // 光标在标题末尾（空标题就在标题里，显示「折叠块标题」占位）；回车进正文
      t.setSelection(TextSelection.create(t.doc, at + 2 + title.length));
      return t;
    };
    return [
      new TiptapInputRule({
        find: /^\s*>>\s$/,
        handler: ({ state, range }) => {
          const $s = state.doc.resolve(range.from);
          if ($s.parent.type.name !== 'paragraph' || hasNode($s.parent, 'hardBreak') || hasNode($s.parent, 'image')) return null;
          if (!toDetails(state, range.from, range.to, false)) return null;
        },
      }),
      new TiptapInputRule({
        find: /^\s*>\s$/,
        handler: ({ state, range }) => {
          const $s = state.doc.resolve(range.from);
          const d = $s.depth;
          if (d < 2 || $s.parent.type.name !== 'paragraph' || hasNode($s.parent, 'hardBreak') || hasNode($s.parent, 'image')) return null;
          const quote = $s.node(d - 1);
          if (quote.type.name !== 'blockquote' || quote.childCount !== 1) return null;
          if (!toDetails(state, range.from, range.to, true)) return null;
        },
      }),
    ];
  },
});

export const detailsParse: ParseSpec[] = [
  {
    name: 'details',
    match: (n) => n.type === 'details',
    run: (state, node, type) => {
      const d = node as unknown as DetailsMd;
      const summary = type.schema.nodes.details_summary!;
      state.openNode(type, { attrs: d.attrs, inline: d.inline, hasSummary: d.hasSummary, expanded: isOpenAttr(d.attrs) });
      state.openNode(summary, { attrs: d.summaryAttrs });
      if (d.summary) state.addText(d.summary);
      state.closeNode();
      if (d.children.length) state.next(d.children);
      else state.openNode(type.schema.nodes.paragraph!).closeNode();
      state.closeNode();
    },
  },
];

export const detailsSerialize: Record<string, SerializeSpec> = {
  details: {
    node: (state, node) => {
      const head = node.firstChild!;
      const title = head.textContent.replace(/\n/g, ' ');
      const open = `<details${String(node.attrs.attrs ?? '')}>`;
      const sum = title || node.attrs.hasSummary ? `<summary${String(head.attrs.attrs ?? '')}>${title}</summary>` : '';
      const body: PMNode[] = [];
      node.forEach((c, _o, i) => i > 0 && body.push(c));
      const only = body.length === 1 ? body[0]! : null;
      const oneLine = node.attrs.inline && only?.type.name === 'paragraph' && !only.textContent.includes('\n') && !hasNode(only, 'hardBreak');
      if (oneLine) {
        state.openNode('paragraph');
        state.addNode('html', undefined, open + sum);
        state.next(only.content);
        state.addNode('html', undefined, '</details>');
        state.closeNode();
        return;
      }
      state.addNode('html', undefined, sum ? `${open}\n${sum}` : open);
      const empty = body.every((c) => c.type.name === 'paragraph' && c.content.size === 0);
      if (!empty) body.forEach((c) => state.next(c));
      state.addNode('html', undefined, '</details>');
    },
  },
};

const hasNode = (n: PMNode, name: string) => {
  let hit = false;
  n.descendants((c) => {
    if (c.type.name === name) hit = true;
    return !hit;
  });
  return hit;
};

/** 折叠块的节点视图：外面一个不可编辑的三角按钮，里面是标题 + 正文（contentDOM）。 */
function detailsView(initial: PMNode, view: EditorView, getPos: () => number | undefined): NodeView {
  let node = initial;
  const dom = document.createElement('div');
  dom.dataset.type = 'details';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'md-details-toggle';
  btn.contentEditable = 'false';
  btn.tabIndex = -1;
  const inner = document.createElement('div');
  inner.className = 'md-details-inner';
  dom.append(btn, inner);
  const draw = () => {
    const on = !!node.attrs.expanded;
    dom.className = `md-details${on ? ' is-open' : ''}`;
    dom.dataset.attrs = String(node.attrs.attrs ?? '');
    btn.setAttribute('aria-expanded', String(on));
    btn.setAttribute('aria-label', on ? tr('收起折叠块') : tr('展开折叠块'));
    btn.title = on ? tr('收起折叠块') : tr('展开折叠块');
  };
  draw();
  btn.addEventListener('mousedown', (e) => e.preventDefault());
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    const pos = getPos();
    if (pos == null) return;
    const on = !node.attrs.expanded;
    const t = view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, expanded: on }).setMeta('addToHistory', false);
    // 收起时光标在正文里：挪到标题末尾
    const { from } = view.state.selection;
    if (!on && from > pos + node.firstChild!.nodeSize && from < pos + node.nodeSize) t.setSelection(TextSelection.create(t.doc, pos + 1 + node.firstChild!.nodeSize - 1));
    view.dispatch(t);
  });
  return {
    dom,
    contentDOM: inner,
    update(n) {
      if (n.type !== node.type) return false;
      node = n;
      draw();
      return true;
    },
    ignoreMutation: (m) => m.target === dom || btn.contains(m.target as Node) || (m.type === 'attributes' && m.target === inner),
    stopEvent: (e) => btn.contains(e.target as Node),
  };
}

// ───────── 操作 ─────────

/** 光标所在最近的折叠块：位置、节点、深度。 */
export function detailsAt(state: EditorState, pos = state.selection.from): { pos: number; node: PMNode; depth: number } | null {
  const $p = state.doc.resolve(pos);
  for (let d = $p.depth; d > 0; d--) if ($p.node(d).type.name === 'details') return { pos: $p.before(d), node: $p.node(d), depth: d };
  return null;
}

/** 光标在折叠块标题里。 */
const inSummary = (state: EditorState) => state.selection.$from.parent.type.name === 'details_summary' && state.selection.$from.sameParent(state.selection.$to);

/** 拆开折叠块：标题（有字的话）变成一段文字，正文原样留下。 */
export function unwrapDetails(state: EditorState, at: { pos: number; node: PMNode }): Transaction {
  const { schema } = state;
  const parts: PMNode[] = [];
  const title = at.node.firstChild!.textContent;
  if (title) parts.push(schema.nodes.paragraph!.create(null, schema.text(title)));
  at.node.forEach((c, _o, i) => {
    if (i === 0) return;
    if (c.type.name === 'paragraph' && c.content.size === 0 && parts.length) return;
    parts.push(c);
  });
  if (!parts.length) parts.push(schema.nodes.paragraph!.create());
  const t = state.tr.replaceWith(at.pos, at.pos + at.node.nodeSize, Fragment.from(parts));
  return t.setSelection(TextSelection.near(t.doc.resolve(at.pos + 1)));
}

/** 做一个折叠块：标题文字、正文（空 = 一个空段落），展开着。 */
export function makeDetails(state: EditorState, title: string, body: PMNode[] = [], attrs = ''): PMNode {
  const { schema } = state;
  const n = schema.nodes;
  return n.details!.create({ attrs, inline: false, hasSummary: true, expanded: true }, [
    n.details_summary!.create(null, title ? schema.text(title) : null),
    ...(body.length ? body : [n.paragraph!.create()]),
  ]);
}

/** 一行 `<details>`（可带 open、<summary>标题</summary>）回车：变成折叠块。 */
export const DETAILS_LINE_RE = /^<details(\s+open)?\s*>\s*(?:<summary>(.*?)<\/summary>\s*)?$/i;

function detailsOnEnter(view: EditorView): boolean {
  const { state } = view;
  const { $from, empty } = state.selection;
  if (!empty || $from.parent.type.name !== 'paragraph' || $from.parentOffset !== $from.parent.content.size) return false;
  const m = DETAILS_LINE_RE.exec($from.parent.textContent.trim());
  if (!m) return false;
  const d = $from.depth;
  const parent = $from.node(d - 1);
  const idx = $from.index(d - 1);
  const type = state.schema.nodes.details!;
  if (!parent.canReplaceWith(idx, idx + 1, type)) return false;
  const at = $from.before(d);
  const title = (m[2] ?? '').trim();
  const t = state.tr.replaceWith(at, $from.after(d), makeDetails(state, title, [], m[1] ? ' open' : ''));
  // 有标题：进正文；没标题：先写标题
  const pos = title ? at + 1 + (title.length + 2) + 1 : at + 2;
  view.dispatch(t.setSelection(TextSelection.create(t.doc, pos)).scrollIntoView());
  return true;
}

const placeholderKey = new PluginKey('md-details-placeholder');

/** 回车 / 退格 / 上下键；空标题的占位文字；光标进了收起的正文就展开。 */
const detailsKeys = () =>
    new Plugin({
      key: placeholderKey,
      props: {
        decorations(state) {
          const decos: Decoration[] = [];
          state.doc.descendants((n, pos) => {
            if (n.type.name === 'details_summary' && n.content.size === 0) decos.push(Decoration.node(pos, pos + n.nodeSize, { class: 'is-empty', 'data-placeholder': tr('折叠块标题') }));
            return !n.isTextblock;
          });
          return decos.length ? DecorationSet.create(state.doc, decos) : null;
        },
        handleKeyDown(view, event) {
          if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return false;
          const { state } = view;
          const { $from, empty } = state.selection;
          if (event.key === 'Enter' && !event.shiftKey) {
            if (inSummary(state)) {
              const cur = detailsAt(state)!;
              // 标题里回车：进正文第一行（第一块不是空段落就在前面插一个）
              const bodyStart = cur.pos + 1 + cur.node.firstChild!.nodeSize;
              const first = cur.node.child(1);
              const t = state.tr;
              if (!cur.node.attrs.expanded) t.setNodeMarkup(cur.pos, undefined, { ...cur.node.attrs, expanded: true });
              if (!(first.type.name === 'paragraph' && first.content.size === 0)) t.insert(bodyStart, state.schema.nodes.paragraph!.create());
              t.setSelection(TextSelection.create(t.doc, bodyStart + 1));
              view.dispatch(t.scrollIntoView());
              event.preventDefault();
              return true;
            }
            if (detailsOnEnter(view)) {
              event.preventDefault();
              return true;
            }
            return false;
          }
          if (event.key === 'Backspace' && empty && inSummary(state) && $from.parentOffset === 0) {
            const cur = detailsAt(state)!;
            view.dispatch(unwrapDetails(state, cur).scrollIntoView());
            event.preventDefault();
            return true;
          }
          if (event.shiftKey || !empty) return false;
          // 收起时 ↓：跳过正文到下一块（后面没有就补一段）
          if (event.key === 'ArrowDown' && inSummary(state) && view.endOfTextblock('down')) {
            const cur = detailsAt(state)!;
            if (cur.node.attrs.expanded) return false;
            const end = cur.pos + cur.node.nodeSize;
            const t = state.tr;
            const $end = state.doc.resolve(end);
            if (!$end.nodeAfter) t.insert(end, state.schema.nodes.paragraph!.create());
            t.setSelection(Selection.near(t.doc.resolve(end + 1)));
            view.dispatch(t.scrollIntoView());
            event.preventDefault();
            return true;
          }
          // 下一块开头 ↑：回到收起的折叠块标题
          if (event.key === 'ArrowUp' && $from.depth >= 1 && view.endOfTextblock('up')) {
            // 从光标所在块往外找：哪一层前面紧挨着一个收起的折叠块（这一层是第一个就再往外）
            for (let d = $from.depth - 1; d >= 0; d--) {
              const idx = $from.index(d);
              if (idx === 0) continue;
              const before = $from.node(d).child(idx - 1);
              if (before.type.name !== 'details' || before.attrs.expanded) break;
              const start = $from.before(d + 1) - before.nodeSize;
              view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, start + 1 + before.firstChild!.nodeSize - 1)).scrollIntoView());
              event.preventDefault();
              return true;
            }
          }
          return false;
        },
      },
      appendTransaction(trs, _old, state) {
        if (!trs.some((t) => t.selectionSet || t.docChanged)) return null;
        const { $head } = state.selection;
        let t: Transaction | null = null;
        for (let d = $head.depth; d > 0; d--) {
          const n = $head.node(d);
          if (n.type.name !== 'details' || n.attrs.expanded) continue;
          // 在标题里不用展开
          if (d + 1 <= $head.depth && $head.node(d + 1).type.name === 'details_summary') continue;
          (t ??= state.tr).setNodeMarkup($head.before(d), undefined, { ...n.attrs, expanded: true });
        }
        return t ? t.setMeta('addToHistory', false) : null;
      },
    });

/** 编辑器里要用的全部扩展。 */
export const detailsExtensions = [
  DetailsSummary,
  Details,
  Extension.create({ name: 'mindoughDetails', priority: 1050, addProseMirrorPlugins: () => [detailsKeys()] }),
];
