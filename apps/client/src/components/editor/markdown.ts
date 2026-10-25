/**
 * 编辑器的 markdown 读写（Rei 2026-10-25 把编辑器从 Milkdown 换成 Tiptap，存的仍是 markdown）。
 *
 * 选型：不用 Tiptap 官方的 @tiptap/markdown（基于 marked，写出格式和以前存的不一样，表格对齐、脚注、HTML 块也弱），
 * 也不用 prosemirror-markdown（markdown-it，同样会改写老数据）。这里沿用 Milkdown 一直在用的 remark：
 *   读：remark-parse + remark-gfm（+ 公式、提示块、折叠块）→ mdast → ProseMirror 文档（Tiptap 的 schema）
 *   写：ProseMirror 文档 → mdast → remark-stringify（同样的选项）
 * 读写规则逐条照搬 Milkdown 7 的 commonmark / gfm 预设（列表 spread、强调符号、单换行、空段落 `<br />`、表格对齐……），
 * 所以老数据读进来再写出去和以前一字不差（`markdown.test.ts` 拿 Milkdown 的输出逐条比过，见 PLAN）。
 */
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkStringify, { type Options as StringifyOptions } from 'remark-stringify';
import remarkGfm from 'remark-gfm';
import remarkInlineLinks from 'remark-inline-links';
import { Fragment, Mark, type Attrs, type MarkType, type Node as PMNode, type NodeType, type Schema } from '@tiptap/pm/model';

// ───────── mdast ─────────

export interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  data?: Record<string, unknown>;
  position?: { start: { offset?: number }; end: { offset?: number } };
  [k: string]: unknown;
}

// ───────── 读：mdast → ProseMirror ─────────

export interface ParseSpec {
  /** ProseMirror 里的节点 / mark 名。 */
  name: string;
  mark?: boolean;
  match: (n: MdNode) => boolean;
  run: (state: ParserState, n: MdNode, type: NodeType & MarkType) => void;
}

interface Frame {
  type: NodeType;
  content: PMNode[];
  attrs?: Attrs | null;
}

/** 和 Milkdown 的 ParserState 一样的栈：openNode / closeNode / addNode / addText / openMark / closeMark。 */
export class ParserState {
  private stack: Frame[] = [];
  private marks: readonly Mark[] = Mark.none;
  constructor(
    readonly schema: Schema,
    private specs: ParseSpec[],
  ) {}

  private top = () => this.stack[this.stack.length - 1];

  private runNode(n: MdNode) {
    const spec = this.specs.find((s) => s.match(n));
    if (!spec) {
      // 认不出的节点（理论上没有）：别整篇读不出来，把里面的字留下
      if (n.children) this.next(n.children);
      else if (typeof n.value === 'string' && n.value) this.addText(n.value);
      return;
    }
    const type = (spec.mark ? this.schema.marks[spec.name] : this.schema.nodes[spec.name]) as NodeType & MarkType;
    spec.run(this, n, type);
  }

  next = (nodes: MdNode | MdNode[] = []) => {
    for (const n of [nodes].flat()) this.runNode(n);
    return this;
  };

  openNode = (type: NodeType, attrs?: Attrs | null) => {
    this.stack.push({ type, content: [], attrs });
    return this;
  };

  private push(node: PMNode) {
    this.top()?.content.push(node);
  }

  private addNodeAndPush(type: NodeType, attrs?: Attrs | null, content?: PMNode[]) {
    const node = type.createAndFill(attrs ?? null, content, this.marks);
    if (!node) throw new Error(`markdown: cannot create ${type.name}`);
    this.push(node);
    return node;
  }

  private closeAndPush() {
    this.marks = Mark.none;
    const el = this.stack.pop();
    if (!el) throw new Error('markdown: stack underflow');
    return this.addNodeAndPush(el.type, el.attrs, el.content);
  }

  closeNode = () => {
    try {
      this.closeAndPush();
    } catch (e) {
      console.error(e);
    }
    return this;
  };

  addNode = (type: NodeType, attrs?: Attrs | null, content?: PMNode[]) => {
    try {
      this.addNodeAndPush(type, attrs, content);
    } catch (e) {
      console.error(e);
    }
    return this;
  };

  openMark = (type: MarkType, attrs?: Attrs | null) => {
    this.marks = type.create(attrs ?? null).addToSet(this.marks);
    return this;
  };

  closeMark = (type: MarkType) => {
    this.marks = type.removeFromSet(this.marks);
    return this;
  };

  addText = (text: string) => {
    if (!text) return this; // ProseMirror 不收空文字节点
    const top = this.top();
    if (!top) return this;
    const prev = top.content.pop();
    const cur = this.schema.text(text, this.marks);
    if (!prev) top.content.push(cur);
    else if (prev.isText && Mark.sameSet(prev.marks, cur.marks)) top.content.push(this.schema.text(prev.text! + text, prev.marks));
    else top.content.push(prev, cur);
    return this;
  };

  build(): PMNode {
    let doc: PMNode | undefined;
    do doc = this.closeAndPush();
    while (this.stack.length);
    return doc;
  }
}

// ───────── 写：ProseMirror → mdast ─────────

export interface SerializeSpec {
  node?: (state: SerializerState, node: PMNode) => void;
  /** 返回 true：这个 mark 已经把节点写掉了（行内代码）。 */
  mark?: (state: SerializerState, mark: Mark, node: PMNode) => boolean | void;
}

interface SFrame {
  type: string;
  children?: MdNode[];
  value?: string;
  props: Record<string, unknown>;
}

/**
 * mark 的先后：和 Milkdown 一样——行内代码最后（priority 100），其余按 Milkdown schema 的注册顺序
 * （强调、粗体、链接、删除线）。顺序决定 `***粗斜***`、`[**粗**](…)` 这类嵌套怎么写。
 */
const MARK_RANK: Record<string, number> = { italic: 0, bold: 1, link: 2, strike: 3, code: 100 };
const rankOf = (m: Mark) => MARK_RANK[m.type.name] ?? 50;

/** 和 Milkdown 的 SerializerState 一样（含相邻同样 mark 合并、mark 两头的空格挪到外面）。 */
export class SerializerState {
  private stack: SFrame[] = [];
  private openMarks: { mark: Mark; spanning: boolean }[] = [];
  constructor(private specs: Record<string, SerializeSpec>) {}

  private top = () => this.stack[this.stack.length - 1];

  private orderMarks(marks: readonly Mark[]): Mark[] {
    const rest = [...marks].sort((a, b) => rankOf(a) - rankOf(b));
    const continuing: Mark[] = [];
    for (const { mark } of this.openMarks) {
      const i = rest.findIndex((x) => x.eq(mark));
      if (i >= 0) continuing.push(...rest.splice(i, 1));
    }
    return continuing.concat(rest);
  }

  private closeEndedMarks(next?: PMNode) {
    const nextMarks = next?.marks;
    let keep = 0;
    while (keep < this.openMarks.length) {
      const { mark, spanning } = this.openMarks[keep]!;
      if (spanning && nextMarks?.some((x) => x.eq(mark))) keep++;
      else break;
    }
    for (let i = this.openMarks.length - 1; i >= keep; i--) this.closeMarkInternal(this.openMarks[i]!.mark);
  }

  private runNode(node: PMNode, next?: PMNode) {
    const marks = this.orderMarks(node.marks);
    const goOn = marks.every((m) => !this.specs[m.type.name]?.mark?.(this, m, node));
    if (goOn) {
      const spec = this.specs[node.type.name]?.node;
      if (!spec) throw new Error(`markdown: no serializer for ${node.type.name}`);
      spec(this, node);
    }
    this.closeEndedMarks(next);
  }

  private mergeChildren(node: MdNode): MdNode {
    const { children } = node;
    if (!children) return node;
    node.children = children.reduce<MdNode[]>((acc, child, i) => {
      if (i === 0) return [child];
      const last = acc[acc.length - 1];
      if (last && last.isMark && child.isMark) {
        const { children: cur, ...curRest } = child;
        const { children: prev, ...prevRest } = last;
        if (child.type === last.type && cur && prev && JSON.stringify(curRest) === JSON.stringify(prevRest)) {
          return acc.slice(0, -1).concat(this.mergeChildren({ ...prevRest, type: last.type, children: [...prev, ...cur] }));
        }
      }
      return acc.concat(child);
    }, []);
    return node;
  }

  private addAndPush(type: string, children?: MdNode[], value?: string, props: Record<string, unknown> = {}): MdNode {
    const node: MdNode = { ...props, type };
    if (children) node.children = children;
    if (value) node.value = value;
    const merged = this.mergeChildren(node);
    const top = this.top();
    if (top) (top.children ??= []).push(merged);
    return merged;
  }

  private moveSpaces(el: SFrame, push: () => MdNode) {
    let start = '';
    let end = '';
    const kids = el.children;
    if (kids) {
      const first = kids[0];
      const last = kids[kids.length - 1];
      if (last && last.type === 'text' && String(last.value).endsWith(' ')) {
        const t = String(last.value);
        const trimmed = t.trimEnd();
        end = t.slice(trimmed.length);
        last.value = trimmed;
      }
      if (first && first.type === 'text' && String(first.value).startsWith(' ')) {
        const t = String(first.value);
        const trimmed = t.trimStart();
        start = t.slice(0, t.length - trimmed.length);
        first.value = trimmed;
      }
    }
    if (start) this.addAndPush('text', undefined, start);
    const out = push();
    if (end) this.addAndPush('text', undefined, end);
    return out;
  }

  private closeAndPush(trim = false): MdNode {
    const el = this.stack.pop();
    if (!el) throw new Error('markdown: stack underflow');
    const push = () => this.addAndPush(el.type, el.children, el.value, el.props);
    return trim ? this.moveSpaces(el, push) : push();
  }

  openNode = (type: string, value?: string, props: Record<string, unknown> = {}) => {
    this.stack.push({ type, value, props });
    return this;
  };

  closeNode = () => {
    this.closeAndPush();
    return this;
  };

  addNode = (type: string, children?: MdNode[], value?: string, props?: Record<string, unknown>) => {
    this.addAndPush(type, children, value, props);
    return this;
  };

  withMark = (mark: Mark, type: string, value?: string, props?: Record<string, unknown>) => {
    if (this.openMarks.some((x) => x.mark.eq(mark))) return this;
    this.openMarks.push({ mark, spanning: value == null });
    return this.openNode(type, value, { ...props, isMark: true });
  };

  private closeMarkInternal(mark: Mark) {
    let i = -1;
    for (let k = this.openMarks.length - 1; k >= 0; k--)
      if (this.openMarks[k]!.mark.eq(mark)) {
        i = k;
        break;
      }
    if (i < 0) return;
    this.openMarks.splice(i, 1);
    this.closeAndPush(true);
  }

  next = (nodes: PMNode | Fragment) => {
    if (nodes instanceof Fragment) nodes.forEach((n, _o, i) => this.runNode(n, nodes.maybeChild(i + 1) ?? undefined));
    else this.runNode(nodes);
    return this;
  };

  run(doc: PMNode): MdNode {
    this.openMarks = [];
    this.next(doc);
    let root: MdNode;
    do root = this.closeAndPush();
    while (this.stack.length);
    root.children ??= [];
    return root;
  }
}

// ───────── remark 插件（照搬 Milkdown commonmark 预设里的几个）─────────

type Parent = MdNode & { children: MdNode[] };
const isParent = (n: MdNode): n is Parent => Array.isArray(n.children);

/** 遍历：fn 返回替换的节点列表（不改就 [node]）；先处理孩子。 */
function flatMap(n: MdNode, fn: (node: MdNode, parent: MdNode | null) => MdNode[], parent: MdNode | null = null): MdNode[] {
  if (isParent(n)) n.children = n.children.flatMap((c) => flatMap(c, fn, n));
  return fn(n, parent);
}

const visitAll = (n: MdNode, fn: (node: MdNode, parent: MdNode | null) => void, parent: MdNode | null = null) => {
  fn(n, parent);
  if (isParent(n)) for (const c of [...n.children]) visitAll(c, fn, n);
};

/** 有序列表的项记下编号（label），写清单时用。 */
const remarkAddOrderInList = () => (tree: MdNode) =>
  visitAll(tree, (n) => {
    if (n.type !== 'list' || !n.ordered || !isParent(n)) return;
    const start = typeof n.start === 'number' ? n.start : 1;
    n.children.forEach((c, i) => (c.label = i + start));
  });

/** 文字里的换行（单换行）拆成 break（isInline）：编辑器里显示成空格，写回还是换行。 */
const remarkLineBreak = () => (tree: MdNode) => {
  const find = /[\t ]*(?:\r?\n|\r)/g;
  const walk = (node: MdNode) => {
    if (!isParent(node)) return;
    const out: MdNode[] = [];
    for (const c of node.children) {
      if (c.type !== 'text' || typeof c.value !== 'string' || !c.value) {
        walk(c);
        out.push(c);
        continue;
      }
      const v = c.value;
      find.lastIndex = 0;
      let start = 0;
      let m = find.exec(v);
      if (!m) {
        out.push(c);
        continue;
      }
      while (m) {
        if (start !== m.index) out.push({ type: 'text', value: v.slice(start, m.index) });
        out.push({ type: 'break', data: { isInline: true } });
        start = m.index + m[0].length;
        m = find.exec(v);
      }
      if (start < v.length) out.push({ type: 'text', value: v.slice(start) });
    }
    node.children = out;
  };
  walk(tree);
};

const BLOCK_CONTAINERS = new Set(['root', 'blockquote', 'listItem', 'footnoteDefinition']);

/** 块级 HTML 包进段落（编辑器里 html 是行内节点）。 */
const remarkHtmlTransformer = () => (tree: MdNode) => {
  flatMap(tree, (node, parent) => {
    if (node.type !== 'html') return [node];
    if (parent && BLOCK_CONTAINERS.has(parent.type)) {
      const value = node.value;
      const leaf: MdNode = { ...node };
      node.children = [leaf];
      leaf.value = value;
      delete node.value;
      node.type = 'paragraph';
    }
    return [node];
  });
};

/** 记下强调 / 粗体原来用的符号（* 还是 _），写回照原样。 */
const remarkMarker = () => (tree: MdNode, file: { value?: unknown }) => {
  const src = String(file?.value ?? '');
  visitAll(tree, (n) => {
    if ((n.type === 'strong' || n.type === 'emphasis') && n.position?.start.offset != null) n.marker = src.charAt(n.position.start.offset);
  });
};

const BR_RE = /^<br\s*\/?\s*>$/i;
/** `<br />` 一行：读成空段落（空段落写出去就是它）。 */
const remarkPreserveEmptyLine = () => (tree: MdNode) => {
  const walk = (node: MdNode) => {
    if (!isParent(node)) return;
    for (const c of node.children) {
      if (c.type === 'html' && BR_RE.test(String(c.value ?? '').trim())) {
        if (node.type === 'paragraph' || node.type === 'tableCell') {
          if (node.children.length === 1) node.children = [];
          continue;
        }
        if (BLOCK_CONTAINERS.has(node.type)) {
          c.children = [];
          delete c.value;
          c.type = 'paragraph';
          continue;
        }
      }
      walk(c);
    }
  };
  walk(tree);
};

// ───────── 写出的选项（和 Milkdown 一样）─────────

type Handler = (node: MdNode, parent: unknown, state: StringifyState, info: Record<string, unknown>) => string;
interface StringifyState {
  safe(v: string, info: unknown): string;
  options: { strong?: string; emphasis?: string };
  enter(name: string): () => void;
  createTracker(info: unknown): { move(s: string): string; current(): Record<string, unknown> };
  containerPhrasing(node: unknown, info: unknown): string;
}

const markHandler =
  (name: 'strong' | 'emphasis', double: boolean): Handler =>
  (node, _p, state, info) => {
    const marker = String(node.marker || (name === 'strong' ? state.options.strong : state.options.emphasis) || '*');
    const m = double ? marker + marker : marker;
    const exit = state.enter(name);
    const tracker = state.createTracker(info);
    let value = tracker.move(m);
    value += tracker.move(state.containerPhrasing(node, { before: value, after: marker, ...tracker.current() }));
    value += tracker.move(m);
    exit();
    return value;
  };

/** Milkdown 的 text 写法：末尾的空格不编成 &#x20;。 */
const textHandler: Handler = (node, _p, state, info) => {
  const value = String(node.value ?? '');
  if (/^[^*_\\]*\s+$/.test(value)) return value;
  return state.safe(value, { ...info, encode: [] });
};

// ───────── 组装 ─────────

export interface MarkdownPlugins {
  /** 额外的 remark 插件（按顺序，跟在 gfm 后面）。 */
  remark: unknown[];
  parse: ParseSpec[];
  serialize: Record<string, SerializeSpec>;
  /** 包一层 text 写法（公式：文字里的 $ 不转义）。 */
  wrapText?: (prev: Handler) => Handler;
}

export interface MarkdownIO {
  parse(md: string): PMNode;
  serialize(doc: PMNode): string;
}

const ZW = '\u200b';

/** 读入前：空的清单项补零宽空格，GFM 才认得出是清单。 */
export function prepareMarkdown(md: string): string {
  return md.replace(/^(\s*[-*+] \[[ xX]\])[ \t]*$/gm, `$1 ${ZW}`);
}

/** 写出后：去掉零宽空格，末尾只留一个换行（和原文比较时不因格式差异算改动）。 */
export function finishMarkdown(md: string): string {
  const s = md
    .replaceAll(ZW, '')
    .replace(/\s+$/, '')
    // 空的清单项写回「- [ ] 」（带空格，老的预览和别的编辑器才认得出）
    .replace(/^(\s*[-*+] \[[ xX]\])[ \t]*$/gm, '$1 ');
  return s.trim() ? `${s}\n` : '';
}

/** 两段 markdown 是否只是格式差异（末尾空白）。 */
export const sameMarkdown = (a: string, b: string) => a.replace(/\s+$/, '') === b.replace(/\s+$/, '');

export function createMarkdownIO(schema: Schema, extra: MarkdownPlugins): MarkdownIO {
  const prevText = textHandler;
  const options = {
    handlers: {
      strong: markHandler('strong', true) as never,
      emphasis: markHandler('emphasis', false) as never,
      text: (extra.wrapText ? extra.wrapText(prevText) : prevText) as never,
    },
    encode: [],
    bullet: '-',
    emphasis: '*',
    strong: '*',
    rule: '-',
    fences: true,
  } as StringifyOptions;
  type Proc = { use(plugin: unknown, opts?: unknown): Proc };
  let processor = (unified() as unknown as Proc)
    .use(remarkParse)
    .use(remarkStringify, options)
    .use(remarkAddOrderInList)
    .use(remarkInlineLinks)
    .use(remarkLineBreak)
    .use(remarkHtmlTransformer)
    .use(remarkMarker)
    .use(remarkPreserveEmptyLine)
    .use(remarkGfm);
  for (const p of extra.remark) processor = processor.use(p);
  const remark = processor as unknown as {
    parse(s: string): MdNode;
    runSync(t: MdNode, file: string): MdNode;
    stringify(t: MdNode): string;
  };
  const parseSpecs = [...coreParse, ...extra.parse];
  const serializeSpecs = { ...coreSerialize, ...extra.serialize };
  return {
    parse(md) {
      const src = prepareMarkdown(md);
      const tree = remark.runSync(remark.parse(src), src);
      const state = new ParserState(schema, parseSpecs);
      state.next(tree);
      return state.build();
    },
    serialize(doc) {
      const state = new SerializerState(serializeSpecs);
      return finishMarkdown(remark.stringify(state.run(doc)));
    },
  };
}

/** 文字块最后一个是硬换行：不写它（和 Milkdown 一样）。 */
export function serializeText(state: SerializerState, node: PMNode) {
  const last = node.lastChild;
  if (last?.type.name !== 'hardBreak') return void state.next(node.content);
  state.next(node.content.cut(0, node.content.size - last.nodeSize));
}

/** 表格单元格：里面那一段的行内内容（去掉末尾硬换行）。 */
function serializeCell(state: SerializerState, node: PMNode) {
  const p = node.firstChild;
  if (node.childCount !== 1 || p?.type.name !== 'paragraph') return void state.next(node.content);
  const last = p.lastChild;
  state.next(last?.type.name === 'hardBreak' ? p.content.cut(0, p.content.size - last.nodeSize) : p.content);
}

type Align = string | null;

const coreParse: ParseSpec[] = [
  { name: 'doc', match: (n) => n.type === 'root', run: (s, n, t) => void s.openNode(t).next(n.children) },
  {
    name: 'paragraph',
    match: (n) => n.type === 'paragraph',
    run: (s, n, t) => {
      s.openNode(t);
      if (n.children) s.next(n.children);
      else s.addText(String(n.value ?? ''));
      s.closeNode();
    },
  },
  { name: 'heading', match: (n) => n.type === 'heading', run: (s, n, t) => void s.openNode(t, { level: n.depth }).next(n.children).closeNode() },
  { name: 'blockquote', match: (n) => n.type === 'blockquote', run: (s, n, t) => void s.openNode(t).next(n.children).closeNode() },
  {
    name: 'codeBlock',
    match: (n) => n.type === 'code',
    run: (s, n, t) => {
      s.openNode(t, { language: n.lang ?? '' });
      if (n.value) s.addText(String(n.value));
      s.closeNode();
    },
  },
  { name: 'horizontalRule', match: (n) => n.type === 'thematicBreak', run: (s, _n, t) => void s.addNode(t) },
  {
    name: 'image',
    match: (n) => n.type === 'image',
    run: (s, n, t) => void s.addNode(t, { src: String(n.url ?? ''), alt: (n.alt as string | null) ?? '', title: (n.title as string | null) ?? '' }),
  },
  { name: 'hardBreak', match: (n) => n.type === 'break', run: (s, n, t) => void s.addNode(t, { isInline: Boolean(n.data?.isInline) }) },
  { name: 'html', match: (n) => n.type === 'html', run: (s, n, t) => void s.addNode(t, { value: String(n.value ?? '') }) },
  { name: 'bulletList', match: (n) => n.type === 'list' && !n.ordered, run: (s, n, t) => void s.openNode(t, { spread: n.spread ?? false }).next(n.children).closeNode() },
  {
    name: 'orderedList',
    match: (n) => n.type === 'list' && !!n.ordered,
    run: (s, n, t) => void s.openNode(t, { spread: n.spread ?? true, start: n.start ?? 1 }).next(n.children).closeNode(),
  },
  {
    name: 'listItem',
    match: (n) => n.type === 'listItem',
    run: (s, n, t) => {
      const label = n.label != null ? `${String(n.label)}.` : '•';
      const listType = n.label != null ? 'ordered' : 'bullet';
      const spread = n.spread ?? true;
      const checked = n.checked != null ? Boolean(n.checked) : null;
      s.openNode(t, { label, listType, spread, checked }).next(n.children).closeNode();
    },
  },
  {
    name: 'table',
    match: (n) => n.type === 'table',
    run: (s, n, t) => {
      const align = (n.align ?? []) as Align[];
      s.openNode(t)
        .next((n.children ?? []).map((x, i) => ({ ...x, align, isHeader: i === 0 })))
        .closeNode();
    },
  },
  {
    name: 'tableRow',
    match: (n) => n.type === 'tableRow',
    run: (s, n, t) => {
      const align = (n.align ?? []) as Align[];
      s.openNode(t)
        .next((n.children ?? []).map((x, i) => ({ ...x, align: align[i] ?? null, isHeader: n.isHeader })))
        .closeNode();
    },
  },
  {
    name: 'tableHeader',
    match: (n) => n.type === 'tableCell' && !!n.isHeader,
    run: (s, n, t) => void s.openNode(t, { align: n.align ?? null }).openNode(s.schema.nodes.paragraph!).next(n.children).closeNode().closeNode(),
  },
  {
    name: 'tableCell',
    match: (n) => n.type === 'tableCell' && !n.isHeader,
    run: (s, n, t) => void s.openNode(t, { align: n.align ?? null }).openNode(s.schema.nodes.paragraph!).next(n.children).closeNode().closeNode(),
  },
  { name: 'footnote_definition', match: (n) => n.type === 'footnoteDefinition', run: (s, n, t) => void s.openNode(t, { label: String(n.label ?? '') }).next(n.children).closeNode() },
  { name: 'footnote_reference', match: (n) => n.type === 'footnoteReference', run: (s, n, t) => void s.addNode(t, { label: String(n.label ?? '') }) },
  { name: 'text', match: (n) => n.type === 'text', run: (s, n) => void s.addText(String(n.value ?? '')) },
  // marks
  { name: 'italic', mark: true, match: (n) => n.type === 'emphasis', run: (s, n, t) => void s.openMark(t, { marker: n.marker ?? '*' }).next(n.children).closeMark(t) },
  { name: 'bold', mark: true, match: (n) => n.type === 'strong', run: (s, n, t) => void s.openMark(t, { marker: n.marker ?? '*' }).next(n.children).closeMark(t) },
  { name: 'code', mark: true, match: (n) => n.type === 'inlineCode', run: (s, n, t) => void s.openMark(t).addText(String(n.value ?? '')).closeMark(t) },
  { name: 'link', mark: true, match: (n) => n.type === 'link', run: (s, n, t) => void s.openMark(t, { href: n.url, title: n.title ?? null }).next(n.children).closeMark(t) },
  { name: 'strike', mark: true, match: (n) => n.type === 'delete', run: (s, n, t) => void s.openMark(t).next(n.children).closeMark(t) },
];

const coreSerialize: Record<string, SerializeSpec> = {
  doc: {
    node: (s, node) => {
      s.openNode('root');
      // 最后一个空段落是打字的地方，不算内容
      const last = node.childCount ? node.child(node.childCount - 1) : null;
      s.next(last?.type.name === 'paragraph' && last.content.size === 0 ? node.content.cut(0, node.content.size - last.nodeSize) : node.content);
    },
  },
  paragraph: {
    node: (s, node) => {
      s.openNode('paragraph');
      if (node.content.size === 0) s.addNode('html', undefined, '<br />');
      else serializeText(s, node);
      s.closeNode();
    },
  },
  heading: {
    node: (s, node) => {
      s.openNode('heading', undefined, { depth: node.attrs.level });
      serializeText(s, node);
      s.closeNode();
    },
  },
  blockquote: { node: (s, node) => void s.openNode('blockquote').next(node.content).closeNode() },
  codeBlock: { node: (s, node) => void s.addNode('code', undefined, node.content.firstChild?.text || '', { lang: node.attrs.language }) },
  horizontalRule: { node: (s) => void s.addNode('thematicBreak') },
  image: { node: (s, node) => void s.addNode('image', undefined, undefined, { title: node.attrs.title, url: node.attrs.src, alt: node.attrs.alt }) },
  hardBreak: { node: (s, node) => void (node.attrs.isInline ? s.addNode('text', undefined, '\n') : s.addNode('break')) },
  html: { node: (s, node) => void s.addNode('html', undefined, String(node.attrs.value ?? '')) },
  bulletList: { node: (s, node) => void s.openNode('list', undefined, { ordered: false, spread: node.attrs.spread }).next(node.content).closeNode() },
  orderedList: {
    node: (s, node) => void s.openNode('list', undefined, { ordered: true, start: node.attrs.start ?? 1, spread: node.attrs.spread }).next(node.content).closeNode(),
  },
  listItem: {
    node: (s, node) => {
      const a = node.attrs;
      const props = a.checked == null ? { spread: a.spread } : { label: a.label, listType: a.listType, spread: a.spread, checked: a.checked };
      s.openNode('listItem', undefined, props).next(node.content).closeNode();
    },
  },
  table: {
    node: (s, node) => {
      const first = node.firstChild;
      if (!first) return;
      const align: Align[] = [];
      first.forEach((c) => align.push((c.attrs.align as Align) ?? null));
      s.openNode('table', undefined, { align }).next(node.content).closeNode();
    },
  },
  tableRow: {
    node: (s, node) => {
      if (node.content.size === 0) return;
      s.openNode('tableRow').next(node.content).closeNode();
    },
  },
  tableHeader: {
    node: (s, node) => {
      s.openNode('tableCell');
      serializeCell(s, node);
      s.closeNode();
    },
  },
  tableCell: {
    node: (s, node) => {
      s.openNode('tableCell');
      serializeCell(s, node);
      s.closeNode();
    },
  },
  footnote_definition: {
    node: (s, node) => void s.openNode('footnoteDefinition', undefined, { label: node.attrs.label, identifier: node.attrs.label }).next(node.content).closeNode(),
  },
  footnote_reference: { node: (s, node) => void s.addNode('footnoteReference', undefined, undefined, { label: node.attrs.label, identifier: node.attrs.label }) },
  text: { node: (s, node) => void s.addNode('text', undefined, node.text ?? '') },
  italic: { mark: (s, m) => void s.withMark(m, 'emphasis', undefined, { marker: m.attrs.marker }) },
  bold: { mark: (s, m) => void s.withMark(m, 'strong', undefined, { marker: m.attrs.marker }) },
  code: {
    mark: (s, m, node) => {
      s.withMark(m, 'inlineCode', node.text || '');
      return true;
    },
  },
  link: { mark: (s, m) => void s.withMark(m, 'link', undefined, { title: m.attrs.title, url: m.attrs.href }) },
  strike: { mark: (s, m) => void s.withMark(m, 'delete') },
};
