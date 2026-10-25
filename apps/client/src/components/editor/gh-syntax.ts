/**
 * 编辑器里的 GitHub 扩展语法（Rei 2026-10-17）：提示块 `> [!NOTE]` 和数学公式 `$…$` / `$$…$$`。存的 markdown 原样不变。
 *
 * 提示块：remark 读入时把「第一行是 [!NOTE]」的引用块改成 ghAlert，编辑器里是 gh_alert 节点（标题 + 图标不可编辑，下面照常写）；
 *   写出时还原成引用块，第一行 `[!NOTE]`（大小写照原样）。手打：「> 」变引用后打 [!NOTE]，打完 ] 就变成提示块。
 * 公式：micromark-extension-math 读 $…$ / $$…$$，再按 GitHub 规则把不像公式的（「$5 和 $10」）还原成文字；
 *   行内 math_inline / 块级 math_block 节点里放的是源码，平时显示 KaTeX，光标进去（点它、←/→/退格挨着它）显示源码可改。
 *   写出：行内照原来的 $ 个数；文字里的 $ 不转义（免得「$5」被存成「\$5」）。手打 $x$ 收尾即变；紧接着打数字（$5$1）变回文字。
 *   块级：一行 $$ 回车（或「$$ 」）开一个公式块；块里最后一行打 $$ 回车结束。
 */
import { Extension, Node as TiptapNode } from '@tiptap/core';
import { InputRule, inputRules } from '@tiptap/pm/inputrules';
import { Plugin, PluginKey, Selection, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView, type NodeView } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import { math } from 'micromark-extension-math';
import { mathFromMarkdown, mathToMarkdown } from 'mdast-util-math';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { ALERT_KINDS, alertIconSvg, alertTitle, parseAlertMarker, type AlertKind } from '../../lib/gh-alerts';
import { MATH_INPUT_RE, provideKatex, renderMath, validInlineMath } from '../../lib/math';
import type { MdNode, ParseSpec, SerializeSpec } from './markdown';

provideKatex(katex);

// ───────── remark：读入 / 写出 ─────────


/** 引用块第一段以 [!NOTE] 开头：改成 ghAlert（kind、marker），去掉标记那行。 */
export function liftAlerts(tree: MdNode) {
  const walk = (node: MdNode) => {
    node.children?.forEach(walk);
    if (node.type !== 'blockquote' || !node.children?.length) return;
    const para = node.children[0]!;
    if (para.type !== 'paragraph' || !para.children?.length) return;
    const text = para.children[0]!;
    if (text.type !== 'text' || typeof text.value !== 'string') return;
    const hit = parseAlertMarker(text.value);
    if (!hit) return;
    if (hit.rest) text.value = hit.rest;
    else {
      para.children.shift();
      if (para.children[0]?.type === 'break') para.children.shift();
    }
    if (!para.children.length) node.children.shift();
    node.type = 'ghAlert';
    node.kind = hit.kind;
    node.marker = hit.marker;
    if (!node.children.length) node.children.push({ type: 'paragraph', children: [] });
  };
  walk(tree);
}

/** 按 GitHub 规则检查行内公式：不成立的还原成文字（原文照抄），成立的记下 $ 个数（写出时照原样）。 */
export function fixInlineMath(tree: MdNode, src: string) {
  const walk = (node: MdNode) => {
    if (!node.children) return;
    node.children = node.children.map((c) => {
      walk(c);
      if (c.type !== 'inlineMath') return c;
      const s = c.position?.start.offset;
      const e = c.position?.end.offset;
      if (s == null || e == null) return c;
      const raw = src.slice(s, e);
      const fence = /^\$+/.exec(raw)?.[0].length ?? 1;
      const inner = raw.slice(fence, raw.length - fence);
      if (!validInlineMath(inner, src[e])) return { type: 'text', value: raw, position: c.position };
      c.data = { ...c.data, fence };
      return c;
    });
  };
  walk(tree);
}

/**
 * 文字里的 $ 不转义（「$5」不会存成「\$5」）；只有读回来会被当成公式的那一对才转义（原文本来就是 \$x\$）。
 */
export function escapeMathLike(out: string): string {
  return out.replace(/(?<![\\$])(\$+)(?!\$)((?:\\.|[^\\$])+?)\1(?!\$)/g, (whole, f: string, inner: string, off: number, all: string) =>
    validInlineMath(inner, all[off + whole.length]) ? `\\${whole}` : whole,
  );
}

type TextHandler = (node: MdNode, parent: unknown, state: { safe(v: string, info: unknown): string }, info: unknown) => string;
/** 包一层 text 写法（handlers 选项会盖过插件的，所以在 markdown.ts 组装时装）。 */
export const mathSafeText =
  (prev?: TextHandler): TextHandler =>
  (node, parent, state, info) =>
    escapeMathLike(prev ? prev(node, parent, state, info) : state.safe(node.value ?? '', info));

type Unsafe = { character: string; inConstruct?: string | string[]; atBreak?: boolean };

/** remark 插件：公式语法（micromark）+ 提示块 / 公式的读入整理；写出时文字里的 $ 不转义、行内公式照原来的 $ 个数。 */
export function remarkGh(this: { data(): Record<string, unknown[]> }) {
  const data = this.data() as Record<string, unknown[] | undefined>;
  (data.micromarkExtensions ??= []).push(math({ singleDollarTextMath: true }));
  (data.fromMarkdownExtensions ??= []).push(mathFromMarkdown());
  const to = mathToMarkdown({ singleDollarTextMath: true }) as { unsafe: Unsafe[]; handlers: Record<string, unknown> };
  const inlineMath = (node: MdNode) => {
    const f = Number(node.data?.fence ?? 1) || 1;
    const value = node.value ?? '';
    // 里面有同样长的一串 $：加长围栏（不然写出去读不回来）
    let fence = '$'.repeat(f);
    while (value.includes(fence)) fence += '$';
    return `${fence}${value}${fence}`;
  };
  (data.toMarkdownExtensions ??= []).push({
    unsafe: to.unsafe.filter((u) => !(u.character === '$' && u.inConstruct === 'phrasing')),
    handlers: { ...to.handlers, inlineMath },
    // 提示块标记和下一块之间不空行：「> [!NOTE]\n> 内容」
    join: [(left: MdNode) => (left.type === 'html' && left.data?.ghAlertMarker ? 0 : undefined)],
  });
  return (tree: MdNode, file: { value?: unknown }) => {
    fixInlineMath(tree, String(file?.value ?? ''));
    liftAlerts(tree);
  };
}


// ───────── 提示块 ─────────

const isKind = (k: unknown): k is AlertKind => (ALERT_KINDS as readonly unknown[]).includes(k);

function alertDom(kind: AlertKind, marker: string) {
  const dom = document.createElement('div');
  dom.className = `md-alert md-alert-${kind}`;
  dom.dataset.alert = kind;
  dom.dataset.marker = marker;
  const title = document.createElement('div');
  title.className = 'md-alert-title';
  title.contentEditable = 'false';
  title.innerHTML = alertIconSvg(kind);
  const label = document.createElement('span');
  label.textContent = alertTitle(kind);
  title.appendChild(label);
  const body = document.createElement('div');
  body.className = 'md-alert-body';
  dom.append(title, body);
  return { dom, contentDOM: body };
}

/** 提示块：标题 + 图标不可编辑，下面照常写（content block+）。 */
export const GhAlert = TiptapNode.create({
  name: 'gh_alert',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes: () => ({ kind: { default: 'note', rendered: false }, marker: { default: 'NOTE', rendered: false } }),
  parseHTML: () => [
    {
      tag: 'div[data-alert]',
      contentElement: '.md-alert-body',
      getAttrs: (dom) => {
        const kind = (dom as HTMLElement).dataset.alert;
        return isKind(kind) ? { kind, marker: (dom as HTMLElement).dataset.marker || kind.toUpperCase() } : false;
      },
    },
  ],
  renderHTML: ({ node }) => alertDom(isKind(node.attrs.kind) ? node.attrs.kind : 'note', String(node.attrs.marker)),
});

/** 引用块第一段里打 [!NOTE]（打完 ]）：这个引用块变成提示块。 */
const alertInputRule = () =>
  new InputRule(/^\[!(note|tip|important|warning|caution)\]$/i, (state, match, start, end) => {
    const $s = state.doc.resolve(start);
    const d = $s.depth;
    if (d < 2 || $s.parent.type.name !== 'paragraph') return null;
    const quote = $s.node(d - 1);
    if (quote.type.name !== 'blockquote' || $s.index(d - 1) !== 0) return null;
    const kind = match[1]!.toLowerCase();
    const tr = state.tr.delete(start, end);
    tr.setNodeMarkup($s.before(d - 1), state.schema.nodes.gh_alert, { kind, marker: match[1]!.toUpperCase() });
    return tr;
  });

// ───────── 公式 ─────────

/** 行内公式：节点里放源码（code: true，不带格式）；平时显示 KaTeX。 */
export const MathInline = TiptapNode.create({
  name: 'math_inline',
  group: 'inline',
  inline: true,
  content: 'text*',
  marks: '',
  code: true,
  addAttributes: () => ({ fence: { default: 1, rendered: false } }),
  parseHTML: () => [{ tag: 'span[data-type="math_inline"]', preserveWhitespace: 'full' as const, contentElement: '.md-math-src' }],
  renderHTML: () => ['span', { 'data-type': 'math_inline', class: 'md-math-inline' }, ['span', { class: 'md-math-src' }, 0]],
  addNodeView: () => (p) => mathView(false)(p.node, p.view, p.getPos as () => number | undefined),
});

/** 块级公式（`$$` 独占行、```math）。 */
export const MathBlock = TiptapNode.create({
  name: 'math_block',
  group: 'block',
  content: 'text*',
  marks: '',
  code: true,
  defining: true,
  parseHTML: () => [{ tag: 'div[data-type="math_block"]', preserveWhitespace: 'full' as const, contentElement: 'pre' }],
  renderHTML: () => ['div', { 'data-type': 'math_block', class: 'md-math-block-edit' }, ['pre', { class: 'md-math-src' }, 0]],
  addNodeView: () => (p) => mathView(true)(p.node, p.view, p.getPos as () => number | undefined),
});

/** markdown 读：ghAlert / inlineMath / math。 */
export const ghParse: ParseSpec[] = [
  { name: 'gh_alert', match: (n) => n.type === 'ghAlert', run: (s, n, t) => void s.openNode(t, { kind: n.kind, marker: n.marker }).next(n.children).closeNode() },
  {
    name: 'math_inline',
    match: (n) => n.type === 'inlineMath',
    run: (s, n, t) => {
      s.openNode(t, { fence: Number(n.data?.fence ?? 1) || 1 });
      if (n.value) s.addText(String(n.value));
      s.closeNode();
    },
  },
  {
    name: 'math_block',
    match: (n) => n.type === 'math',
    run: (s, n, t) => {
      s.openNode(t);
      if (n.value) s.addText(String(n.value));
      s.closeNode();
    },
  },
];

/** markdown 写：提示块还原成引用块（标记是单独一个 html 节点，原样输出不被转义成 \[），公式照原来的 $ 个数。 */
export const ghSerialize: Record<string, SerializeSpec> = {
  gh_alert: {
    node: (state, node) => {
      const marker = `[!${String(node.attrs.marker || 'NOTE')}]`;
      state.openNode('blockquote');
      state.addNode('html', undefined, marker, { data: { ghAlertMarker: true } });
      node.content.forEach((child, _off, i) => {
        if (i === 0 && child.type.name === 'paragraph' && child.content.size === 0) return; // 空的第一段不写
        state.next(child);
      });
      state.closeNode();
    },
  },
  math_inline: {
    node: (state, node) => {
      if (!node.textContent) return; // 空的公式不写
      state.addNode('inlineMath', undefined, node.textContent, { data: { fence: node.attrs.fence } });
    },
  },
  math_block: { node: (state, node) => void state.addNode('math', undefined, node.textContent) },
};

/** 公式节点视图：源码（contentDOM）+ KaTeX 结果（不可编辑，点它进源码）。是否在编辑看外面的 is-editing 装饰。 */
function mathView(display: boolean) {
  return (initial: PMNode, view: EditorView, getPos: () => number | undefined): NodeView => {
    let node = initial;
    const dom = document.createElement(display ? 'div' : 'span');
    dom.className = display ? 'md-math-block-edit' : 'md-math-inline';
    dom.dataset.type = display ? 'math_block' : 'math_inline';
    const src = document.createElement(display ? 'pre' : 'span');
    src.className = 'md-math-src';
    src.spellcheck = false;
    const out = document.createElement(display ? 'div' : 'span');
    out.className = 'md-math-render';
    out.contentEditable = 'false';
    dom.append(src, out);
    let drawn: string | null = null;
    const draw = () => {
      const text = node.textContent;
      dom.classList.toggle('is-empty', !text.trim());
      if (text === drawn) return;
      drawn = text;
      out.innerHTML = text.trim() ? renderMath(text, display) : '';
    };
    draw();
    // 没在改的时候整个节点就是结果：按下去把光标放到源码末尾。用 pointerdown（外层弹层在 pointerdown 上
    // preventDefault 时浏览器不再发 mousedown），事件挂在外层 dom 上（KaTeX 的子元素有时不是事件目标）。
    const editing = () => dom.classList.contains('is-editing');
    const hitsResult = (t: EventTarget | null) => !editing() || out.contains(t as Node);
    dom.addEventListener('mousedown', (e) => hitsResult(e.target) && e.preventDefault());
    dom.addEventListener('pointerdown', (e) => {
      if ((e as PointerEvent).button !== 0 || !hitsResult(e.target)) return;
      e.preventDefault();
      const pos = getPos();
      if (pos == null) return;
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos + node.nodeSize - 1)));
      view.focus();
    });
    return {
      dom,
      contentDOM: src,
      update(n) {
        if (n.type !== node.type) return false;
        node = n;
        draw();
        return true;
      },
      ignoreMutation: (m) => out.contains(m.target as Node),
      // 结果区里的事件 ProseMirror 不管（点它由上面的 pointerdown 把光标放进源码）
      stopEvent: (e) => (e.type.startsWith('mouse') || e.type.startsWith('pointer') || e.type === 'click') && hitsResult(e.target),
    };
  };
}


const isMath = (n: PMNode | null | undefined) => !!n && (n.type.name === 'math_inline' || n.type.name === 'math_block');

/** 光标所在的公式节点：[pos, node]。 */
function mathAt(state: EditorState): { pos: number; node: PMNode } | null {
  const { $from, $to } = state.selection;
  if (!isMath($from.parent) || $from.parent !== $to.parent) return null;
  return { pos: $from.before(), node: $from.parent };
}

const mathEditKey = new PluginKey('md-math-edit');

/** 光标在公式里：给它加 is-editing（显示源码）。光标离开后，空的行内公式删掉。 */
const mathEditing = () =>
    new Plugin({
      key: mathEditKey,
      props: {
        decorations(state) {
          const hit = mathAt(state);
          if (!hit) return null;
          return DecorationSet.create(state.doc, [Decoration.node(hit.pos, hit.pos + hit.node.nodeSize, { class: 'is-editing' })]);
        },
      },
      appendTransaction(trs, _old, state) {
        if (!trs.some((t) => t.docChanged || t.selectionSet)) return null;
        const cur = mathAt(state);
        const empties: number[] = [];
        state.doc.descendants((n, pos) => {
          if (n.type.name === 'math_inline' && n.content.size === 0 && cur?.pos !== pos) empties.push(pos);
          return n.isBlock;
        });
        if (!empties.length) return null;
        const tr = state.tr;
        for (const pos of empties.reverse()) tr.delete(pos, pos + 1 + 1);
        return tr.setMeta('addToHistory', false);
      },
    });

const canMathAt = (state: EditorState, pos: number) => {
  const $s = state.doc.resolve(pos);
  if ($s.parent.type.spec.code) return false;
  return !$s.marks().some((m) => m.type.name === 'inlineCode' || m.type.name === 'link');
};

/** 手打 $公式$：打完结尾的 $ 变成公式，光标放在公式后面。 */
const mathInputRule = () =>
    new InputRule(MATH_INPUT_RE, (state, match, start, end) => {
      const inner = match[1];
      if (!inner || !canMathAt(state, start)) return null;
      const type = state.schema.nodes.math_inline!;
      const tr = state.tr.replaceWith(start, end, type.create({ fence: 1 }, state.schema.text(inner)));
      return tr.setSelection(TextSelection.create(tr.doc, start + inner.length + 2));
    });

/** 公式后面紧跟着打数字（「$5$1」）：GitHub 不当公式，变回文字。 */
const mathDigitRule = () =>
    new InputRule(/\d$/, (state, match, start) => {
      const $s = state.doc.resolve(start);
      const before = $s.nodeBefore;
      if (!before || before.type.name !== 'math_inline') return null;
      const f = '$'.repeat(Number(before.attrs.fence) || 1);
      const from = start - before.nodeSize;
      return state.tr.replaceWith(from, start, state.schema.text(`${f}${before.textContent}${f}${match[0]}`));
    });

function insertMathBlock(state: EditorState, from: number, to: number, dispatch: (tr: Transaction) => void) {
  const type = state.schema.nodes.math_block;
  if (!type) return false;
  const tr = state.tr.replaceWith(from, to, type.create());
  tr.setSelection(TextSelection.create(tr.doc, from + 1));
  dispatch(tr.scrollIntoView());
  return true;
}

/** 方向键、退格挨着公式时进去改；块级公式里最后一行打 $$ 回车结束；一行 $$ 回车开公式块。 */
const mathKeys = () =>
    new Plugin({
      props: {
        handleKeyDown(view, event) {
          if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return false;
          const { state } = view;
          const sel = state.selection;
          if (!sel.empty) return false;
          const $c = sel.$from;
          const enter = (pos: number) => {
            view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, pos)).scrollIntoView());
            return true;
          };
          const cur = mathAt(state);
          if (event.key === 'Enter' && !event.shiftKey) {
            if (cur && cur.node.type.name === 'math_block') {
              // 最后一行是 $$：去掉这行，结束公式块
              const text = cur.node.textContent;
              const lastNl = text.lastIndexOf('\n');
              if ($c.parentOffset === text.length && text.slice(lastNl + 1).trim() === '$$') {
                const start = cur.pos + 1;
                const tr = state.tr.delete(start + Math.max(lastNl, 0), start + text.length);
                const end = tr.mapping.map(cur.pos + cur.node.nodeSize);
                tr.insert(end, state.schema.nodes.paragraph!.create());
                tr.setSelection(TextSelection.create(tr.doc, end + 1));
                view.dispatch(tr.scrollIntoView());
                event.preventDefault();
                return true;
              }
              return false;
            }
            if (cur) {
              // 行内公式里回车：出来，放在公式后面
              event.preventDefault();
              return enter(cur.pos + cur.node.nodeSize);
            }
            const para = $c.parent;
            if (para.type.name === 'paragraph' && para.textContent.trim() === '$$' && $c.parentOffset === para.content.size) {
              event.preventDefault();
              return insertMathBlock(state, $c.before(), $c.after(), view.dispatch.bind(view));
            }
            return false;
          }
          if (event.shiftKey) return false;
          if (cur && cur.node.type.name === 'math_inline') {
            // 在行内公式两头：←/→ 出去
            if (event.key === 'ArrowLeft' && $c.parentOffset === 0) {
              event.preventDefault();
              return enter(cur.pos);
            }
            if (event.key === 'ArrowRight' && $c.parentOffset === cur.node.content.size) {
              event.preventDefault();
              return enter(cur.pos + cur.node.nodeSize);
            }
            return false;
          }
          if (cur) return false;
          const before = $c.nodeBefore;
          const after = $c.nodeAfter;
          if ((event.key === 'ArrowLeft' || event.key === 'Backspace') && before?.type.name === 'math_inline') {
            event.preventDefault();
            return enter($c.pos - 1);
          }
          if ((event.key === 'ArrowRight' || event.key === 'Delete') && after?.type.name === 'math_inline') {
            event.preventDefault();
            return enter($c.pos + 1);
          }
          // 上下键走到公式块：进它的源码
          if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && $c.depth >= 1 && view.endOfTextblock(event.key === 'ArrowDown' ? 'down' : 'up')) {
            const down = event.key === 'ArrowDown';
            const edge = down ? $c.after() : $c.before();
            const $e = state.doc.resolve(edge);
            const next = down ? $e.nodeAfter : $e.nodeBefore;
            if (next?.type.name === 'math_block') {
              event.preventDefault();
              return enter(down ? edge + 1 : edge - 1);
            }
          }
          return false;
        },
      },
    });

/** 「$$ 」开公式块。 */
const mathBlockInputRule = () =>
    new InputRule(/^\$\$\s$/, (state, _m, start, end) => {
      const $s = state.doc.resolve(start);
      if ($s.parent.type.name !== 'paragraph' || $s.parent.textContent.length !== end - $s.start()) return null;
      const type = state.schema.nodes.math_block;
      if (!type) return null;
      const tr = state.tr.replaceWith($s.before(), $s.after(), type.create());
      return tr.setSelection(Selection.near(tr.doc.resolve($s.before() + 1)));
    });

/** 编辑器里要用的全部扩展（节点 + 光标进出公式、手打规则）。 */
export const ghExtensions = [
  GhAlert,
  MathInline,
  MathBlock,
  Extension.create({
    name: 'mindoughGhSyntax',
    priority: 1100,
    addProseMirrorPlugins: () => [mathEditing(), mathKeys(), inputRules({ rules: [alertInputRule(), mathInputRule(), mathDigitRule(), mathBlockInputRule()] })],
  }),
];
