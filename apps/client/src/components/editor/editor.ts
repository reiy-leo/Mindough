/**
 * Markdown 所见即所得编辑器的内核（Rei 2026-10-25：「用 Tiptap 替代 Milkdown，提供 WYSIWYG」）。入库仍是 markdown 文本：
 * 打开时 remark 读成文档（markdown.ts），改动后写回 markdown。React 外壳是 MdEditor.tsx（@tiptap/react 的 useEditor），
 * 测试用这里的 createMdEditor（不用 React）。两边走同一套 controller：
 *
 * - 老数据打开不写回：打开时先记下「这篇文档写出去是什么样」（canon）。没真的改字（展开折叠块、光标进公式、自动补的东西）
 *   写出去还是 canon，就不调 onChange；真的改了才调。所以原文里 `* 列表`、`__粗__` 这种非标准写法，只看不改也不会被改写。
 * - 外面的值变了（同步下来）且不是自己刚写的：整篇替换（不进撤销历史）。
 * - 命令（工具栏）、链接的读写（链接框）、选区坐标（浮层定位）都在 handle 上。
 */
import { Editor, getSchema, type AnyExtension, type EditorOptions } from '@tiptap/core';
import { Node as PMNode, type Schema } from '@tiptap/pm/model';
import { TextSelection, type EditorState } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { createMarkdownIO, sameMarkdown, type MarkdownIO } from './markdown';
import { behaviorExtension, linkRangeAt, schemaExtensions, withProtocol, type LinkRange } from './extensions';
import { ghParse, ghSerialize, mathSafeText, remarkGh } from './gh-syntax';
import { detailsAt, detailsParse, detailsSerialize, remarkDetails, toggleDetails } from './details';

export { LINK_INPUT_RE, tableCells, withProtocol, linkRangeAt, type LinkRange } from './extensions';
export { finishMarkdown, prepareMarkdown, sameMarkdown } from './markdown';

export type MdCommand = 'bold' | 'italic' | 'strike' | 'code' | 'h1' | 'h2' | 'h3' | 'text' | 'bullet' | 'ordered' | 'task' | 'quote' | 'codeblock' | 'table' | 'link' | 'details';

// ───────── markdown 读写（每个 schema 一份）─────────

const ios = new WeakMap<Schema, MarkdownIO>();
export function markdownIO(schema: Schema): MarkdownIO {
  let io = ios.get(schema);
  if (!io) {
    io = createMarkdownIO(schema, {
      remark: [remarkGh, remarkDetails],
      parse: [...ghParse, ...detailsParse],
      serialize: { ...ghSerialize, ...detailsSerialize },
      wrapText: mathSafeText as never,
    });
    ios.set(schema, io);
  }
  return io;
}

let base: Schema | null = null;
/** 不建编辑器也能用的 schema（读初始内容、测试往返）。 */
export const baseSchema = () => (base ??= getSchema(schemaExtensions()));

/** 测试用：markdown 读进来再写出去（不需要界面）。 */
export function roundTrip(md: string): string {
  const io = markdownIO(baseSchema());
  return io.serialize(io.parse(md));
}

// ───────── 链接 ─────────

/** 选区所在的链接：空光标在链接里面，或整个选区落在同一段链接里。 */
export function linkAtSelection(state: EditorState): LinkRange | null {
  const { from, to, empty } = state.selection;
  if (empty) return linkRangeAt(state.doc, from);
  const r = linkRangeAt(state.doc, from, false);
  return r && r.from <= from && to <= r.to ? r : null;
}

/** 把 [from, to) 的链接地址改成 href（保留 title）；href 空 = 去掉链接。 */
export function setLinkTr(state: EditorState, range: { from: number; to: number }, href: string) {
  const type = state.schema.marks.link!;
  let title: unknown = null;
  state.doc.nodesBetween(range.from, range.to, (n) => {
    const m = type.isInSet(n.marks);
    if (m && title == null) title = m.attrs.title ?? null;
  });
  const tr = state.tr.removeMark(range.from, range.to, type);
  if (href) tr.addMark(range.from, range.to, type.create({ href, ...(title ? { title } : {}) }));
  return tr;
}

/**
 * 链接框里填的网址 → 存进去的地址；不像网址返回 null（Rei 2026-10-17「编辑器中链接要支持编辑名称和链接」）。
 * - 去掉两头空白；中间的空格编成 %20（markdown 里的链接地址不能带空格，否则往返会断）。
 * - 没协议补 https://；mailto: / tel: 照原样；站内的 #/… 照原样。
 * - javascript: / data: / vbscript: 不收。http(s) 要有像样的主机名（带点、localhost 或 IP）。
 */
export function normalizeHref(raw: string): string | null {
  const t = raw.trim().replace(/\s+/g, '%20');
  if (!t) return null;
  if (t.startsWith('#')) return t;
  if (/^(javascript|data|vbscript):/i.test(t)) return null;
  if (/^(mailto|tel):/i.test(t)) return t.length > t.indexOf(':') + 1 ? t : null;
  const url = withProtocol(t.replace(/^\/\//, ''));
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (/^https?:$/.test(u.protocol)) {
    const host = u.hostname;
    if (!host || !(host.includes('.') || host === 'localhost' || /^\[.*\]$/.test(host))) return null;
    if (/^\.|\.$|\.\./.test(host)) return null;
  }
  return url;
}

/**
 * 链接框保存：把 [from, to) 换成「text」并加上链接 href（已规范好的）。
 * - text 空 = 用网址当文字。
 * - 文字没改：只改地址，保留里面的粗体 / 斜体（setLinkTr）。
 * - 文字改了：整段换成新文字，带上原来第一个字的格式（去掉旧链接）。
 * - 空区间（新加）：在 from 插入。跨段落的选区不改文字，只加链接。
 * 保存后光标放在链接后面。
 */
export function applyLinkTr(state: EditorState, range: { from: number; to: number }, text: string, href: string) {
  const type = state.schema.marks.link!;
  const name = text.trim() || href;
  const { from, to } = range;
  const $from = state.doc.resolve(from);
  const $to = state.doc.resolve(to);
  const sameBlock = $from.sameParent($to);
  const cur = from < to ? state.doc.textBetween(from, to, '') : '';
  if (from < to && (!sameBlock || cur === name)) {
    const tr = setLinkTr(state, range, href);
    const end = tr.mapping.map(to);
    tr.setSelection(TextSelection.create(tr.doc, end));
    // 接着打的字不带链接
    return tr.setStoredMarks(tr.doc.resolve(end).marks().filter((m) => m.type !== type));
  }
  let title: unknown = null;
  if (from < to)
    state.doc.nodesBetween(from, to, (n) => {
      const m = type.isInSet(n.marks);
      if (m && title == null) title = m.attrs.title ?? null;
    });
  const base = (from < to ? (state.doc.nodeAt(from)?.marks ?? $from.marks()) : (state.storedMarks ?? $from.marks())).filter((m) => m.type !== type && m.type.name !== 'code');
  const marks = type.create({ href, ...(title ? { title } : {}) }).addToSet(base);
  const tr = state.tr.replaceWith(from, to, state.schema.text(name, marks));
  const end = from + name.length;
  tr.setSelection(TextSelection.create(tr.doc, end));
  tr.setStoredMarks(base);
  return tr;
}

// ───────── 编辑器 ─────────

/** 初始内容（JSON）。万一读不出来（理论上不会），整段当文字放进去，别让编辑器打不开。 */
function initialContent(md: string) {
  const schema = baseSchema();
  try {
    return markdownIO(schema).parse(md).toJSON();
  } catch (err) {
    console.error('markdown 读不出来', err);
    const p = schema.nodes.paragraph!;
    return schema.nodes.doc!.create(null, md ? p.create(null, schema.text(md)) : p.create()).toJSON();
  }
}

export interface MdEditorHandle {
  editor: Editor;
  run(cmd: MdCommand, arg?: string): void;
  setMarkdown(md: string): void;
  getMarkdown(): string;
  focus(): void;
  destroy(): void;
  /** 当前选区是否在某种格式里（工具栏高亮）。 */
  active(): Set<MdCommand>;
  /** 选区所在的链接（见 linkAtSelection）。 */
  linkAtSelection(): LinkRange | null;
  /** 改 / 去掉（href 空）一段链接的地址。 */
  setLink(range: { from: number; to: number }, href: string): void;
  /** 链接框保存：文字 + 地址一起换（见 applyLinkTr）；href 不像网址返回 false、什么都不改。 */
  applyLink(range: { from: number; to: number }, text: string, href: string): boolean;
  /** 一段的纯文字（链接框预填）。 */
  textOf(range: { from: number; to: number }): string;
  /** 当前选区（链接框新加时用）。 */
  selection(): { from: number; to: number };
  /** 链接起点在页面上的位置（浮层定位）。 */
  coordsOf(range: { from: number; to: number }): { left: number; top: number; bottom: number } | null;
  view(): EditorView;
}

export interface MdEditorOptions {
  value: string;
  placeholder: string;
  label: string;
  readOnly?: boolean;
  onChange: (md: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  onEscape?: () => void;
  onLinkShortcut?: () => void;
  onSelection?: () => void;
  /** 鼠标移到链接上（range）/ 移开（null）。 */
  onLinkHover?: (link: LinkRange | null, el: HTMLElement | null) => void;
  /** 点了链接：打开它。 */
  onLinkOpen?: (href: string) => void;
  /** 粘贴 / 拖进正文的图片：上传，返回地址（null = 没传成）。不给就不接图片。 */
  uploadImage?: (file: File) => Promise<string | null>;
}

/** 编辑器的状态和回调（React 外壳和 createMdEditor 共用）。opts 用 getter 取，React 里每次渲染换最新的回调。 */
export class MdController {
  /** 上次交给外面的 / 外面给的原文。 */
  private lastValue: string;
  /** 文档现在写出去的样子（没变就不调 onChange）。 */
  private lastOut: string | null = null;
  editor: Editor | null = null;

  constructor(private get: () => MdEditorOptions) {
    this.lastValue = get().value;
  }

  /** Tiptap 的选项：扩展、初始内容、回调。 */
  options(): Partial<EditorOptions> {
    const o = this.get();
    const io = () => markdownIO(this.editor?.schema ?? baseSchema());
    const extensions: AnyExtension[] = [
      ...schemaExtensions(),
      behaviorExtension({
        placeholder: () => this.get().placeholder,
        onEscape: () => this.get().onEscape?.(),
        onLinkShortcut: o.onLinkShortcut ? () => this.get().onLinkShortcut?.() : undefined,
        onLinkHover: (r, el) => this.get().onLinkHover?.(r, el),
        onLinkOpen: o.onLinkOpen ? (u) => this.get().onLinkOpen?.(u) : undefined,
        uploadImage: o.uploadImage ? (f) => this.get().uploadImage?.(f) ?? Promise.resolve(null) : undefined,
        io,
      }),
    ];
    return {
      extensions,
      content: initialContent(o.value),
      editable: !o.readOnly,
      enablePasteRules: false,
      enableContentCheck: false,
      editorProps: {
        attributes: { class: 'md md-editor-content', role: 'textbox', 'aria-multiline': 'true', 'aria-label': o.label, spellcheck: 'true' },
      },
      onCreate: ({ editor }) => this.attach(editor as Editor),
      onUpdate: () => this.changed(),
      onFocus: () => this.get().onFocus?.(),
      onBlur: () => this.get().onBlur?.(),
      onSelectionUpdate: () => this.get().onSelection?.(),
      onTransaction: () => this.get().onSelection?.(),
    };
  }

  /** 编辑器建好了：记下文档现在写出去的样子（之后没变就不算改动）。 */
  attach(editor: Editor) {
    if (this.editor === editor && this.lastOut != null) return;
    this.editor = editor;
    this.lastOut = this.serialize();
  }

  private serialize() {
    const ed = this.editor!;
    return markdownIO(ed.schema).serialize(ed.state.doc);
  }

  private changed() {
    if (!this.editor) return;
    const out = this.serialize();
    if (this.lastOut == null) this.lastOut = out;
    if (out === this.lastOut) return;
    this.lastOut = out;
    if (sameMarkdown(out, this.lastValue)) return;
    this.lastValue = out;
    this.get().onChange(out);
  }

  /** 外面的值：和上次的一样就不动；不一样整篇换掉（不进撤销历史），光标回到开头。 */
  setMarkdown(md: string) {
    const ed = this.editor;
    if (!ed || sameMarkdown(md, this.lastValue)) return;
    this.lastValue = md;
    const doc = markdownIO(ed.schema).parse(md);
    const view = ed.view;
    const tr = view.state.tr.replaceWith(0, view.state.doc.content.size, doc.content);
    tr.setSelection(TextSelection.atStart(tr.doc));
    this.lastOut = markdownIO(ed.schema).serialize(tr.doc);
    view.dispatch(tr.setMeta('addToHistory', false));
  }

  handle(): MdEditorHandle {
    const ed = this.editor!;
    return makeHandle(ed, this);
  }
}

function makeHandle(editor: Editor, ctl: MdController): MdEditorHandle {
  const view = () => editor.view;
  const chain = () => editor.chain().focus();
  const inList = () => {
    const { $from } = editor.state.selection;
    for (let d = $from.depth; d >= 0; d--) if ($from.node(d).type.name === 'listItem') return true;
    return false;
  };

  const setTask = () => {
    // 先变成无序列表，再把当前所在的列表项都标成清单（已经是清单的取消）
    if (!inList()) editor.commands.toggleBulletList();
    const st = editor.state;
    const tr = st.tr;
    let toggledOff: boolean | null = null;
    st.doc.nodesBetween(st.selection.from, st.selection.to, (node, pos) => {
      if (node.type.name !== 'listItem') return true;
      if (toggledOff === null) toggledOff = node.attrs.checked != null;
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: toggledOff ? null : false });
      return false;
    });
    if (toggledOff === null) {
      const $f = st.selection.$from;
      for (let d = $f.depth; d >= 0; d--) {
        const n = $f.node(d);
        if (n.type.name === 'listItem') {
          tr.setNodeMarkup($f.before(d), undefined, { ...n.attrs, checked: n.attrs.checked != null ? null : false });
          break;
        }
      }
    }
    view().dispatch(tr);
  };

  return {
    editor,
    run(cmd, arg) {
      switch (cmd) {
        case 'bold':
          return void chain().toggleBold().run();
        case 'italic':
          return void chain().toggleItalic().run();
        case 'strike':
          return void chain().toggleStrike().run();
        case 'code':
          return void chain().toggleCode().run();
        case 'h1':
        case 'h2':
        case 'h3':
          return void chain().setHeading({ level: Number(cmd[1]) as 1 | 2 | 3 }).run();
        case 'text':
          return void chain().setParagraph().run();
        case 'bullet':
          return void (inList() ? chain().toggleBulletList().run() : chain().wrapInList('bulletList').run() || chain().toggleBulletList().run());
        case 'ordered':
          return void (inList() ? chain().toggleOrderedList().run() : chain().wrapInList('orderedList').run() || chain().toggleOrderedList().run());
        case 'task':
          return setTask();
        case 'quote':
          return void chain().toggleBlockquote().run();
        case 'codeblock':
          return void chain().setCodeBlock().run();
        case 'table':
          return void chain().insertTable({ rows: 3, cols: 2, withHeaderRow: true }).run();
        case 'details': {
          const v = view();
          toggleDetails(v.state, v.dispatch.bind(v));
          return;
        }
        case 'link': {
          const v = view();
          const href = (arg ?? '').trim();
          if (!href) return;
          // 光标 / 选区在已有链接里：改这一段的地址
          const cur = linkAtSelection(v.state);
          if (cur) return void v.dispatch(setLinkTr(v.state, cur, href));
          if (v.state.selection.empty) {
            // 没选字：把网址本身插进去并加上链接
            const schema = v.state.schema;
            v.dispatch(v.state.tr.insert(v.state.selection.from, schema.text(href, [schema.marks.link!.create({ href })])));
          } else v.dispatch(setLinkTr(v.state, v.state.selection, href));
          return;
        }
      }
    },
    setMarkdown: (md) => ctl.setMarkdown(md),
    getMarkdown: () => markdownIO(editor.schema).serialize(editor.state.doc),
    focus: () => view().focus(),
    destroy: () => editor.destroy(),
    linkAtSelection: () => linkAtSelection(editor.state),
    setLink(range, href) {
      const v = view();
      const size = v.state.doc.content.size;
      if (range.from < 0 || range.to > size || range.from >= range.to) return;
      v.dispatch(setLinkTr(v.state, range, href.trim() ? withProtocol(href.trim()) : ''));
    },
    applyLink(range, text, href) {
      const url = normalizeHref(href);
      if (!url) return false;
      const v = view();
      const size = v.state.doc.content.size;
      if (range.from < 0 || range.to > size || range.from > range.to) return false;
      v.dispatch(applyLinkTr(v.state, range, text, url));
      return true;
    },
    textOf(range) {
      try {
        return editor.state.doc.textBetween(range.from, range.to, ' ');
      } catch {
        return '';
      }
    },
    selection() {
      const v = view();
      // 刚用 Shift+方向键 / 长按改的选区，ProseMirror 可能还没从 DOM 读进来（selectionchange 是异步的）：先读一下
      (v as unknown as { domObserver?: { flush?: () => void } }).domObserver?.flush?.();
      const { from, to } = v.state.selection;
      return { from, to };
    },
    coordsOf(range) {
      try {
        const c = view().coordsAtPos(range.from, 1);
        return { left: c.left, top: c.top, bottom: c.bottom };
      } catch {
        return null;
      }
    },
    view,
    active() {
      const out = new Set<MdCommand>();
      const st = editor.state;
      const { $from, empty, from, to } = st.selection;
      const marks = empty ? (st.storedMarks ?? $from.marks()) : [];
      const has = (name: string) => {
        const type = st.schema.marks[name];
        if (!type) return false;
        return empty ? marks.some((m) => m.type === type) : st.doc.rangeHasMark(from, to, type);
      };
      if (has('bold')) out.add('bold');
      if (has('italic')) out.add('italic');
      if (has('strike')) out.add('strike');
      if (has('code')) out.add('code');
      if (has('link')) out.add('link');
      if (detailsAt(st)) out.add('details');
      for (let d = $from.depth; d >= 0; d--) {
        const n = $from.node(d);
        const name = n.type.name;
        if (name === 'heading') out.add(`h${Math.min(3, n.attrs.level as number)}` as MdCommand);
        if (name === 'blockquote') out.add('quote');
        if (name === 'codeBlock') out.add('codeblock');
        if (name === 'table') out.add('table');
        if (name === 'listItem' && n.attrs.checked != null) out.add('task');
        if (name === 'bulletList' && !out.has('task')) out.add('bullet');
        if (name === 'orderedList') out.add('ordered');
      }
      return out;
    },
  };
}

/**
 * 不用 React 建一个编辑器（测试用；界面用 MdEditor.tsx）。root 里放编辑器；Tab 的冒泡拦在 root 上（见 stopTab）。
 */
export function createMdEditor(opts: MdEditorOptions & { root: HTMLElement }): MdEditorHandle {
  const ctl = new MdController(() => opts);
  const editor = new Editor({ ...ctl.options(), element: opts.root });
  ctl.attach(editor);
  const h = ctl.handle();
  const off = stopTab(opts.root);
  const destroy = h.destroy;
  h.destroy = () => {
    off();
    destroy();
  };
  return h;
}

/**
 * Tab 的冒泡拦在编辑器里：弹层的焦点圈（React Aria FocusScope contain）在 document 上接 Tab，
 * 不管 ProseMirror 已经 preventDefault，照样把焦点挪到下一个按钮。列表缩进 / 表格跳格前面已经做了。
 */
export function stopTab(root: HTMLElement) {
  const fn = (e: KeyboardEvent) => {
    if (e.key !== 'Tab' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (!(e.target as HTMLElement | null)?.closest?.('.ProseMirror')) return;
    e.preventDefault();
    e.stopPropagation();
  };
  root.addEventListener('keydown', fn);
  return () => root.removeEventListener('keydown', fn);
}

export type { PMNode };
