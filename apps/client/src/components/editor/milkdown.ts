/**
 * Markdown 所见即所得编辑器的内核（Milkdown 7：ProseMirror + remark）。入库仍是 markdown 文本：
 * 打开时 remark 解析成文档，改动后 remark 序列化回 markdown。选型理由见 docs/PLAN.md「M3 · 2」。
 *
 * - commonmark + GFM（表格、- [ ] 清单、删除线、自动链接）；撤销重做；粘贴 markdown 自动排版。
 * - 序列化：列表用「-」、强调用「*」、粗体「**」（和我们以前存的写法一致）。
 * - 空的清单项「- [ ] 」（内置正文模板里有）GFM 不认作清单；读入前补一个零宽空格、写出时去掉。
 * - 占位文字、点清单的勾、⌘K 加链接、Esc 收起都在这里。
 * - 网络图片 ![](https://…) 不加载，显示成文字（remote-image.ts；Rei 2026-10-17）。
 */
import { Editor, defaultValueCtx, editorViewCtx, editorViewOptionsCtx, remarkStringifyOptionsCtx, rootCtx, serializerCtx, parserCtx, commandsCtx } from '@milkdown/kit/core';
import { commonmark, toggleStrongCommand, toggleEmphasisCommand, toggleInlineCodeCommand, wrapInBulletListCommand, wrapInOrderedListCommand, wrapInBlockquoteCommand, wrapInHeadingCommand, createCodeBlockCommand, toggleLinkCommand, turnIntoTextCommand } from '@milkdown/kit/preset/commonmark';
import { gfm, toggleStrikethroughCommand, insertTableCommand } from '@milkdown/kit/preset/gfm';
import { history } from '@milkdown/kit/plugin/history';
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener';
import { clipboard } from '@milkdown/kit/plugin/clipboard';
import { $prose } from '@milkdown/kit/utils';
import { liftListItem, sinkListItem } from '@milkdown/kit/prose/schema-list';
import { goToNextCell } from '@milkdown/kit/prose/tables';
import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import type { Node as PMNode } from '@milkdown/kit/prose/model';
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

export interface MdEditorHandle {
  editor: Editor;
  run(cmd: MdCommand, arg?: string): void;
  setMarkdown(md: string): void;
  getMarkdown(): string;
  focus(): void;
  destroy(): Promise<void>;
  /** 当前选区是否在某种格式里（工具栏高亮）。 */
  active(): Set<MdCommand>;
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
    .create();

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
          if (v.state.selection.empty) {
            // 没选字：把网址本身插进去并加上链接
            const schema = v.state.schema;
            const mark = schema.marks.link!.create({ href });
            const tr = v.state.tr.insert(v.state.selection.from, schema.text(href, [mark]));
            v.dispatch(tr);
          } else call(toggleLinkCommand.key, { href });
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
    destroy: () => editor.destroy().then(() => undefined),
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
