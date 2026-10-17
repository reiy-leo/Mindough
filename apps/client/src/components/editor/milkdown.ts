/**
 * Markdown 所见即所得编辑器的内核（Milkdown 7：ProseMirror + remark）。入库仍是 markdown 文本：
 * 打开时 remark 解析成文档，改动后 remark 序列化回 markdown。选型理由见 docs/PLAN.md「M3 · 2」。
 *
 * - commonmark + GFM（表格、- [ ] 清单、删除线、自动链接）；撤销重做；粘贴 markdown 自动排版。
 * - 序列化：列表用「-」、强调用「*」、粗体「**」（和我们以前存的写法一致）。
 * - 空的清单项「- [ ] 」（内置正文模板里有）GFM 不认作清单；读入前补一个零宽空格、写出时去掉。
 * - 占位文字、点清单的勾、⌘K 加链接、Esc 收起都在这里。
 * - 网络图片 ![](https://…) 不加载，显示成文字（remote-image.ts；Rei 2026-10-17）。
 * - 链接（Rei 2026-10-17）：点一下是打开（不进编辑）；悬停 / 光标落在链接里时通知外面显示小浮层（看地址、编辑、去掉）；
 *   改地址按 mark 的范围 removeMark + addMark，不再 toggle 掉。手打 [文字](网址) 打完右括号就变成链接（![图](…) 不算）。
 * - Tab 不让焦点跑出编辑器：弹层（React Aria FocusScope contain）在 document 上自己接 Tab 挪焦点、不看 defaultPrevented，
 *   所以编辑器根节点上把 Tab 的冒泡拦下来。
 */
import { Editor, defaultValueCtx, editorViewCtx, editorViewOptionsCtx, remarkStringifyOptionsCtx, rootCtx, serializerCtx, parserCtx, commandsCtx } from '@milkdown/kit/core';
import { commonmark, toggleStrongCommand, toggleEmphasisCommand, toggleInlineCodeCommand, wrapInBulletListCommand, wrapInOrderedListCommand, wrapInBlockquoteCommand, wrapInHeadingCommand, createCodeBlockCommand, turnIntoTextCommand } from '@milkdown/kit/preset/commonmark';
import { gfm, toggleStrikethroughCommand, insertTableCommand } from '@milkdown/kit/preset/gfm';
import { history } from '@milkdown/kit/plugin/history';
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener';
import { clipboard } from '@milkdown/kit/plugin/clipboard';
import { $inputRule, $prose } from '@milkdown/kit/utils';
import { InputRule } from '@milkdown/kit/prose/inputrules';
import { liftListItem, sinkListItem } from '@milkdown/kit/prose/schema-list';
import { goToNextCell } from '@milkdown/kit/prose/tables';
import { Plugin, PluginKey, TextSelection, type EditorState } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import type { Mark, MarkType, NodeType, Node as PMNode } from '@milkdown/kit/prose/model';
import type { EditorView } from '@milkdown/kit/prose/view';
import { remoteImagePaste, remoteImageView } from './remote-image';

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

export type MdCommand = 'bold' | 'italic' | 'strike' | 'code' | 'h1' | 'h2' | 'h3' | 'text' | 'bullet' | 'ordered' | 'task' | 'quote' | 'codeblock' | 'table' | 'link';

/** 文档里的一段链接：[from, to) 与地址。 */
export interface LinkRange {
  from: number;
  to: number;
  href: string;
}

/** 网址缺协议时补 https://（mailto: 之类有协议的照原样）。 */
export const withProtocol = (url: string) => (/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`);

/**
 * pos 所在那段链接（同一个 link mark 连着的几个文字节点合成一段）。
 * strict：空光标只认在链接里面（不含两端）；inclusive 用于鼠标指着的那个字。
 */
export function linkRangeAt(doc: PMNode, pos: number, type: MarkType, strict = true): LinkRange | null {
  const $pos = doc.resolve(pos);
  const parent = $pos.parent;
  if (!parent.inlineContent) return null;
  const start = $pos.start();
  type Run = { from: number; to: number; mark: Mark };
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

/** 选区所在的链接：空光标在链接里面，或整个选区落在同一段链接里。 */
export function linkAtSelection(state: EditorState): LinkRange | null {
  const type = state.schema.marks.link;
  if (!type) return null;
  const { from, to, empty } = state.selection;
  if (empty) return linkRangeAt(state.doc, from, type);
  const r = linkRangeAt(state.doc, from, type, false);
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

export interface MdEditorHandle {
  editor: Editor;
  run(cmd: MdCommand, arg?: string): void;
  setMarkdown(md: string): void;
  getMarkdown(): string;
  focus(): void;
  destroy(): Promise<void>;
  /** 当前选区是否在某种格式里（工具栏高亮）。 */
  active(): Set<MdCommand>;
  /** 选区所在的链接（见 linkAtSelection）。 */
  linkAtSelection(): LinkRange | null;
  /** 改 / 去掉（href 空）一段链接的地址。 */
  setLink(range: { from: number; to: number }, href: string): void;
  /** 链接起点在页面上的位置（浮层定位）。 */
  coordsOf(range: { from: number; to: number }): { left: number; top: number; bottom: number } | null;
  view(): EditorView;
}

export interface MdEditorOptions {
  root: HTMLElement;
  value: string;
  placeholder: string;
  label: string;
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
}

const placeholderKey = new PluginKey('md-placeholder');

/** 文档只有一个空段落时显示占位文字。 */
const placeholderPlugin = (text: string) =>
  $prose(
    () =>
      new Plugin({
        key: placeholderKey,
        props: {
          decorations(state) {
            const doc = state.doc;
            const first = doc.firstChild;
            if (doc.childCount !== 1 || !first || !first.isTextblock || first.content.size > 0) return null;
            return DecorationSet.create(doc, [Decoration.node(0, first.nodeSize, { class: 'md-placeholder', 'data-placeholder': text })]);
          },
        },
      }),
  );

/** 点清单项左边的勾：切换完成（GFM 的 li[data-item-type=task]，勾画在 ::before 上）。 */
const taskToggle = $prose(
  () =>
    new Plugin({
      props: {
        handleDOMEvents: {
          mousedown(view, event) {
            const li = (event.target as HTMLElement).closest?.('li[data-item-type="task"]') as HTMLElement | null;
            if (!li || !view.dom.contains(li)) return false;
            const rect = li.getBoundingClientRect();
            const x = (event as MouseEvent).clientX - rect.left;
            if (x > 26) return false; // 只在勾的位置
            const pos = view.posAtDOM(li, 0);
            const $pos = view.state.doc.resolve(pos);
            for (let d = $pos.depth; d >= 0; d--) {
              const node = $pos.node(d);
              if (node.type.name === 'list_item' && node.attrs.checked != null) {
                event.preventDefault();
                view.dispatch(view.state.tr.setNodeMarkup($pos.before(d), undefined, { ...node.attrs, checked: !node.attrs.checked }));
                return true;
              }
            }
            return false;
          },
        },
      },
    }),
);

/** 编辑器里的链接：点一下打开（mousedown 不放光标、不进编辑），鼠标移上 / 移开通知外面。 */
const linkPointer = (opts: MdEditorOptions) =>
  $prose(
    () =>
      new Plugin({
        props: {
          handleDOMEvents: {
            mousedown(view, event) {
              const a = (event.target as HTMLElement).closest?.('a[href]') as HTMLAnchorElement | null;
              if (!a || !view.dom.contains(a) || event.button !== 0 || !opts.onLinkOpen) return false;
              event.preventDefault();
              return true;
            },
            click(view, event) {
              const a = (event.target as HTMLElement).closest?.('a[href]') as HTMLAnchorElement | null;
              if (!a || !view.dom.contains(a) || event.button !== 0 || !opts.onLinkOpen) return false;
              event.preventDefault();
              const href = a.getAttribute('href') ?? '';
              if (href) opts.onLinkOpen(href);
              return true;
            },
            mouseover(view, event) {
              const a = (event.target as HTMLElement).closest?.('a[href]') as HTMLAnchorElement | null;
              if (!a || !view.dom.contains(a) || !opts.onLinkHover) return false;
              const type = view.state.schema.marks.link;
              if (!type) return false;
              let pos: number;
              try {
                pos = view.posAtDOM(a, 0);
              } catch {
                return false;
              }
              const r = linkRangeAt(view.state.doc, Math.min(pos + 1, view.state.doc.content.size), type, false) ?? linkRangeAt(view.state.doc, pos, type, false);
              opts.onLinkHover(r, a);
              return false;
            },
            mouseout(view, event) {
              const a = (event.target as HTMLElement).closest?.('a[href]');
              const to = (event as MouseEvent).relatedTarget as HTMLElement | null;
              if (!a || !opts.onLinkHover || (to && a.contains(to))) return false;
              opts.onLinkHover(null, null);
              return false;
            },
          },
        },
      }),
  );

/** 手打 [文字](网址)：打完右括号就变成链接。 */
const linkInputRule = $inputRule(
  () =>
    new InputRule(LINK_INPUT_RE, (state, match, start, end) => {
      const type = state.schema.marks.link;
      const raw = match[2];
      if (!type || !raw) return null;
      const href = withProtocol(raw);
      const text = match[1] || raw;
      // 已经在代码里的不转
      const $s = state.doc.resolve(start);
      if ($s.parent.type.spec.code || $s.marks().some((m) => m.type.name === 'inlineCode')) return null;
      const marks = $s.marks().filter((m) => m.type !== type);
      // end 是触发前的位置：最后那个右括号还没进文档，一起替换掉
      return state.tr.replaceWith(start, end, state.schema.text(text, [...marks, type.create({ href })])).removeStoredMark(type);
    }),
);

/** 光标处能不能加链接：不在代码块、行内代码、已有链接里。 */
const canLinkAt = (state: EditorState, pos: number) => {
  const $s = state.doc.resolve(pos);
  if ($s.parent.type.spec.code) return false;
  return !$s.marks().some((m) => m.type.name === 'inlineCode' || m.type.name === 'link');
};

/** 手打 <网址>：打完 > 变成链接。 */
const angleLinkRule = $inputRule(
  () =>
    new InputRule(ANGLE_LINK_RE, (state, match, start, end) => {
      const type = state.schema.marks.link;
      const url = match[1];
      if (!type || !url || !canLinkAt(state, start)) return null;
      const marks = state.doc.resolve(start).marks();
      return state.tr.replaceWith(start, end, state.schema.text(url, [...marks, type.create({ href: url })])).removeStoredMark(type);
    }),
);

/** 手打裸网址再打空格：网址加上链接，空格照打。 */
const bareUrlRule = $inputRule(
  () =>
    new InputRule(BARE_URL_RE, (state, match, start, end) => {
      const type = state.schema.marks.link;
      const url = match[1];
      if (!type || !url) return null;
      const from = start + match[0].lastIndexOf(url);
      const to = from + url.length;
      if (!canLinkAt(state, from) || state.doc.rangeHasMark(from, to, type)) return null;
      const href = url.startsWith('www.') ? `https://${url}` : url;
      const tr = state.tr.addMark(from, to, type.create({ href }));
      // 补上触发的那个空格（input rule 接管了这次输入）
      return tr.insertText(match[0].slice(-1), end).removeStoredMark(type);
    }),
);

/** 一行 |a|b| 回车：变成表格（这行是表头，下面一行空的），光标进第一格。 */
const tableOnEnter = $prose(
  () =>
    new Plugin({
      props: {
        handleKeyDown(view, event) {
          if (event.key !== 'Enter' || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return false;
          const { state } = view;
          const { $from, empty } = state.selection;
          const n = state.schema.nodes;
          if (!empty || !n.table || !n.table_header_row || !n.table_row || !n.table_header || !n.table_cell || !n.paragraph) return false;
          const para = $from.parent;
          if (para.type !== n.paragraph || $from.parentOffset !== para.content.size) return false;
          // 只在文档顶层（不在列表、引用、表格里）
          if ($from.depth !== 1) return false;
          const cells = tableCells(para.textContent);
          if (!cells || !cells.length) return false;
          const cell = (type: NodeType, text: string) => type.create({ alignment: null }, n.paragraph!.create(null, text ? state.schema.text(text) : null));
          const table = n.table.create(null, [
            n.table_header_row.create(null, cells.map((c) => cell(n.table_header!, c))),
            n.table_row.create(null, cells.map(() => cell(n.table_cell!, ''))),
          ]);
          const before = $from.before();
          const tr = state.tr.replaceWith(before, $from.after(), table);
          // 第一行数据的第一格：table(1) + header_row + row(1) + cell(1) + paragraph(1)
          const headerSize = table.child(0).nodeSize;
          tr.setSelection(TextSelection.create(tr.doc, before + 1 + headerSize + 3));
          view.dispatch(tr.scrollIntoView());
          event.preventDefault();
          return true;
        },
      },
    }),
);

/** Esc 收起、⌘K 加链接；选区变化时通知工具栏。 */
const keys = (opts: MdEditorOptions) =>
  $prose(
    () =>
      new Plugin({
        props: {
          handleKeyDown(view, event) {
            // Tab / Shift+Tab：清单、表格里的缩进由前面的快捷键处理；到这里说明它们没接（第一项不能再缩、
            // 不在清单里……），也要吃掉，免得浏览器把焦点移出编辑器。代码块里 Tab 插两个空格。
            if (event.key === 'Tab' && !event.metaKey && !event.ctrlKey && !event.altKey) {
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
              } else if (inside('table_cell') || inside('table_header')) {
                goToNextCell(event.shiftKey ? -1 : 1)(state, dispatch);
              } else {
                const li = state.schema.nodes.list_item;
                if (li && inside('list_item')) (event.shiftKey ? liftListItem(li) : sinkListItem(li))(state, dispatch);
              }
              view.focus();
              return true;
            }
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
            return false;
          },
        },
        view: () => ({ update: () => opts.onSelection?.() }),
      }),
  );

export async function createMdEditor(opts: MdEditorOptions): Promise<MdEditorHandle> {
  let last = opts.value;
  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, opts.root);
      ctx.set(defaultValueCtx, prepareMarkdown(opts.value));
      ctx.set(remarkStringifyOptionsCtx, { ...ctx.get(remarkStringifyOptionsCtx), bullet: '-', emphasis: '*', strong: '*', rule: '-', fences: true });
      ctx.update(editorViewOptionsCtx, (prev) => ({
        ...prev,
        attributes: { class: 'md md-editor-content', role: 'textbox', 'aria-multiline': 'true', 'aria-label': opts.label, spellcheck: 'true' },
      }));
      const l = ctx.get(listenerCtx);
      l.markdownUpdated((_ctx, md) => {
        const out = finishMarkdown(md);
        if (sameMarkdown(out, last)) return;
        last = out;
        opts.onChange(out);
      });
      l.focus(() => opts.onFocus?.());
      l.blur(() => opts.onBlur?.());
    })
    .use(commonmark)
    .use(gfm)
    .use(history)
    .use(listener)
    .use(remoteImagePaste)
    .use(clipboard)
    .use(placeholderPlugin(opts.placeholder))
    .use(taskToggle)
    .use(keys(opts))
    .use(remoteImageView)
    .use(linkPointer(opts))
    .use(linkInputRule)
    .use(angleLinkRule)
    .use(bareUrlRule)
    .use(tableOnEnter)
    .create();

  // Tab 的冒泡拦在编辑器里：弹层的焦点圈（React Aria FocusScope contain）在 document 上接 Tab，
  // 不管 ProseMirror 已经 preventDefault，照样把焦点挪到下一个按钮。列表缩进 / 表格跳格前面已经做了。
  const stopTab = (e: KeyboardEvent) => {
    if (e.key !== 'Tab' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (!(e.target as HTMLElement | null)?.closest?.('.ProseMirror')) return;
    e.preventDefault();
    e.stopPropagation();
  };
  opts.root.addEventListener('keydown', stopTab);

  const call = (key: unknown, payload?: unknown) => editor.action((ctx) => ctx.get(commandsCtx).call(key as never, payload as never));
  const view = () => editor.action((ctx) => ctx.get(editorViewCtx));

  const setTask = () => {
    // 先变成无序列表，再把当前所在的列表项都标成清单（已经是清单的取消）
    const v = view();
    const { $from } = v.state.selection;
    let inList = false;
    for (let d = $from.depth; d >= 0; d--) if ($from.node(d).type.name === 'list_item') inList = true;
    if (!inList) call(wrapInBulletListCommand.key);
    const v2 = view();
    const st = v2.state;
    const tr = st.tr;
    let toggledOff: boolean | null = null;
    st.doc.nodesBetween(st.selection.from, st.selection.to, (node, pos) => {
      if (node.type.name !== 'list_item') return true;
      if (toggledOff === null) toggledOff = node.attrs.checked != null;
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: toggledOff ? null : false });
      return false;
    });
    if (toggledOff === null) {
      // 选区在列表项里面（nodesBetween 从段落开始）：往上找
      const $f = st.selection.$from;
      for (let d = $f.depth; d >= 0; d--) {
        const n = $f.node(d);
        if (n.type.name === 'list_item') {
          tr.setNodeMarkup($f.before(d), undefined, { ...n.attrs, checked: n.attrs.checked != null ? null : false });
          break;
        }
      }
    }
    v2.dispatch(tr);
  };

  const handle: MdEditorHandle = {
    editor,
    run(cmd, arg) {
      switch (cmd) {
        case 'bold':
          return void call(toggleStrongCommand.key);
        case 'italic':
          return void call(toggleEmphasisCommand.key);
        case 'strike':
          return void call(toggleStrikethroughCommand.key);
        case 'code':
          return void call(toggleInlineCodeCommand.key);
        case 'h1':
        case 'h2':
        case 'h3':
          return void call(wrapInHeadingCommand.key, Number(cmd[1]));
        case 'text':
          return void call(turnIntoTextCommand.key);
        case 'bullet':
          return void call(wrapInBulletListCommand.key);
        case 'ordered':
          return void call(wrapInOrderedListCommand.key);
        case 'task':
          return setTask();
        case 'quote':
          return void call(wrapInBlockquoteCommand.key);
        case 'codeblock':
          return void call(createCodeBlockCommand.key);
        case 'table':
          return void call(insertTableCommand.key, { row: 3, col: 2 });
        case 'link': {
          const v = view();
          const href = (arg ?? '').trim();
          if (!href) return;
          // 光标 / 选区在已有链接里：改这一段的地址（以前 toggle 会把它去掉）
          const cur = linkAtSelection(v.state);
          if (cur) return void v.dispatch(setLinkTr(v.state, cur, href));
          if (v.state.selection.empty) {
            // 没选字：把网址本身插进去并加上链接
            const schema = v.state.schema;
            const mark = schema.marks.link!.create({ href });
            const tr = v.state.tr.insert(v.state.selection.from, schema.text(href, [mark]));
            v.dispatch(tr);
          } else v.dispatch(setLinkTr(v.state, v.state.selection, href));
          return;
        }
      }
    },
    setMarkdown(md) {
      if (sameMarkdown(md, last)) return;
      last = md;
      editor.action((ctx) => {
        const v = ctx.get(editorViewCtx);
        const doc = ctx.get(parserCtx)(prepareMarkdown(md)) as PMNode | string;
        if (typeof doc === 'string') return;
        const tr = v.state.tr.replaceWith(0, v.state.doc.content.size, doc.content);
        tr.setSelection(TextSelection.atStart(tr.doc));
        v.dispatch(tr.setMeta('addToHistory', false));
      });
    },
    getMarkdown() {
      return editor.action((ctx) => finishMarkdown(ctx.get(serializerCtx)(ctx.get(editorViewCtx).state.doc)));
    },
    focus() {
      view().focus();
    },
    destroy: () => {
      opts.root.removeEventListener('keydown', stopTab);
      return editor.destroy().then(() => undefined);
    },
    linkAtSelection: () => linkAtSelection(view().state),
    setLink(range, href) {
      const v = view();
      const size = v.state.doc.content.size;
      if (range.from < 0 || range.to > size || range.from >= range.to) return;
      v.dispatch(setLinkTr(v.state, range, href.trim() ? withProtocol(href.trim()) : ''));
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
      const st = view().state;
      const { $from, empty, from, to } = st.selection;
      const marks = empty ? (st.storedMarks ?? $from.marks()) : [];
      const has = (name: string) => (empty ? marks.some((m) => m.type.name === name) : st.doc.rangeHasMark(from, to, st.schema.marks[name]!));
      if (has('strong')) out.add('bold');
      if (has('emphasis')) out.add('italic');
      if (st.schema.marks.strike_through && has('strike_through')) out.add('strike');
      if (has('inlineCode')) out.add('code');
      if (has('link')) out.add('link');
      for (let d = $from.depth; d >= 0; d--) {
        const n = $from.node(d);
        if (n.type.name === 'heading') out.add(`h${Math.min(3, n.attrs.level as number)}` as MdCommand);
        if (n.type.name === 'blockquote') out.add('quote');
        if (n.type.name === 'code_block') out.add('codeblock');
        if (n.type.name === 'table') out.add('table');
        if (n.type.name === 'list_item' && n.attrs.checked != null) out.add('task');
        if (n.type.name === 'bullet_list' && !out.has('task')) out.add('bullet');
        if (n.type.name === 'ordered_list') out.add('ordered');
      }
      return out;
    },
  };
  return handle;
}

/** 测试用：markdown 经过编辑器读进来再写出去（不需要界面）。 */
export async function roundTrip(md: string): Promise<string> {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const h = await createMdEditor({ root, value: md, placeholder: '', label: '', onChange: () => {} });
  const out = h.getMarkdown();
  await h.destroy();
  root.remove();
  return out;
}
