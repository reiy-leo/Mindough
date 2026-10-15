/**
 * Markdown 所见即所得编辑器（任务内容、资料 / 人物备注）。写的时候就是排好版的样子，存的还是 markdown。
 *
 * - 写法：直接打 markdown 也会变（「# 」标题、「- 」列表、「[ ] 」清单、「> 」引用、「```」代码、**粗体**…）。
 * - 工具栏：编辑时在下方出现一排小按钮（放下面，点进来时文字不跳）（标题 / 粗体 / 斜体 / 删除线 / 清单 / 列表 / 编号 / 引用 / 代码 / 链接 / 表格），
 *   按钮不抢焦点；悬停提示带快捷键。⌘K / Ctrl+K 加链接，Esc 收起。
 * - 外面的值变了（同步下来）且不是自己刚写的：替换内容。
 * 这个文件按需加载（LazyMdEditor），加载完之前显示排好版的预览。
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Bold, Code, Heading, Italic, Link2, List, ListChecks, ListOrdered, Quote, Strikethrough, Table } from 'lucide-react';
import { Button as RacButton, Input, TextField } from 'react-aria-components';
import { Tip } from '../../ui/primitives';
import { tr } from '../../lib/i18n';
import { createMdEditor, type MdCommand, type MdEditorHandle } from './milkdown';
import '@milkdown/kit/prose/view/style/prosemirror.css';

export interface MdEditorProps {
  value: string;
  onChange: (md: string) => void;
  label: string;
  placeholder?: string;
  autoFocus?: boolean;
  onBlur?: () => void;
  onEscape?: () => void;
  className?: string;
  /** 工具栏：编辑时出现（默认）/ 一直显示 / 不要（新建面板：只靠写法变样子，保持安静）。 */
  toolbar?: 'focus' | 'always' | 'none';
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const mod = isMac ? '⌘' : 'Ctrl+';
const alt = isMac ? '⌥' : 'Alt+';
const shift = isMac ? '⇧' : 'Shift+';

interface Tool {
  cmd: MdCommand;
  icon: ReactNode;
  label: () => string;
  keys?: string;
}

const TOOLS: Tool[][] = [
  [{ cmd: 'h2', icon: <Heading size={16} />, label: () => tr('标题'), keys: `${mod}${alt}2` }],
  [
    { cmd: 'bold', icon: <Bold size={16} />, label: () => tr('粗体'), keys: `${mod}B` },
    { cmd: 'italic', icon: <Italic size={16} />, label: () => tr('斜体'), keys: `${mod}I` },
    { cmd: 'strike', icon: <Strikethrough size={16} />, label: () => tr('删除线'), keys: `${mod}${alt}X` },
  ],
  [
    { cmd: 'task', icon: <ListChecks size={16} />, label: () => tr('清单') },
    { cmd: 'bullet', icon: <List size={16} />, label: () => tr('列表'), keys: `${mod}${alt}8` },
    { cmd: 'ordered', icon: <ListOrdered size={16} />, label: () => tr('编号列表'), keys: `${mod}${alt}7` },
    { cmd: 'quote', icon: <Quote size={16} />, label: () => tr('引用'), keys: `${mod}${shift}B` },
    { cmd: 'codeblock', icon: <Code size={16} />, label: () => tr('代码'), keys: `${mod}${alt}C` },
  ],
  [
    { cmd: 'link', icon: <Link2 size={16} />, label: () => tr('链接'), keys: `${mod}K` },
    { cmd: 'table', icon: <Table size={16} />, label: () => tr('表格') },
  ],
];

export function MdEditor({ value, onChange, label, placeholder = '', autoFocus, onBlur, onEscape, className, toolbar = 'focus' }: MdEditorProps) {
  const root = useRef<HTMLDivElement>(null);
  const handle = useRef<MdEditorHandle | null>(null);
  const cb = useRef({ onChange, onBlur, onEscape });
  cb.current = { onChange, onBlur, onEscape };
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState<Set<MdCommand>>(new Set());
  const [linking, setLinking] = useState(false);
  const [href, setHref] = useState('');
  const linkingRef = useRef(false);
  linkingRef.current = linking;
  const initial = useRef(value);

  useEffect(() => {
    let dead = false;
    let h: MdEditorHandle | null = null;
    void createMdEditor({
      root: root.current!,
      value: initial.current,
      label,
      placeholder,
      onChange: (md) => cb.current.onChange(md),
      onFocus: () => setFocused(true),
      onBlur: () => {
        // 点工具栏里的链接输入框不算离开
        setTimeout(() => {
          if (linkingRef.current || root.current?.parentElement?.contains(document.activeElement)) return;
          setFocused(false);
          cb.current.onBlur?.();
        }, 0);
      },
      onEscape: () => cb.current.onEscape?.(),
      ...(toolbar === 'none' ? {} : { onLinkShortcut: () => setLinking(true) }),
      onSelection: () => h && setActive(h.active()),
    }).then((x) => {
      if (dead) return void x.destroy();
      h = x;
      handle.current = x;
      if (autoFocus) x.focus();
    });
    return () => {
      dead = true;
      handle.current = null;
      void h?.destroy();
    };
    // 编辑器只建一次；value 的变化走下面的 setMarkdown
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    handle.current?.setMarkdown(value);
  }, [value]);

  const run = (cmd: MdCommand) => {
    const h = handle.current;
    if (!h) return;
    if (cmd === 'link') {
      setLinking(true);
      return;
    }
    // 标题按钮：已经是标题就变回正文
    h.run(cmd === 'h2' && active.has('h2') ? 'text' : cmd);
    h.focus();
    setActive(h.active());
  };

  const addLink = () => {
    const h = handle.current;
    const url = href.trim();
    setLinking(false);
    setHref('');
    if (!h) return;
    h.focus();
    if (url) h.run('link', /^[a-z]+:/i.test(url) ? url : `https://${url}`);
  };

  const showBar = toolbar !== 'none' && (toolbar === 'always' || focused || linking);
  return (
    <div className={`md-editor${showBar ? ' is-active' : ''}${className ? ` ${className}` : ''}`}>
      <div ref={root} className="md-editor-root" />
      {showBar && (
        <div className="md-toolbar" role="toolbar" aria-label={tr('格式')} onMouseDown={(e) => !(e.target as HTMLElement).closest('input') && e.preventDefault()}>
          {linking ? (
            <form
              className="md-link-form"
              onSubmit={(e) => {
                e.preventDefault();
                addLink();
              }}
            >
              <Link2 size={15} aria-hidden className="muted" />
              <TextField aria-label={tr('链接地址')} value={href} onChange={setHref} autoFocus className="md-link-field">
                <Input
                  className="input md-link-input"
                  placeholder="https://"
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      e.stopPropagation();
                      setLinking(false);
                      handle.current?.focus();
                    }
                  }}
                />
              </TextField>
              <RacButton type="submit" className="btn btn-quiet btn-sm">
                {tr('添加')}
              </RacButton>
              <RacButton
                className="btn btn-quiet btn-sm"
                onPress={() => {
                  setLinking(false);
                  handle.current?.focus();
                }}
              >
                {tr('取消')}
              </RacButton>
            </form>
          ) : (
            TOOLS.map((group, gi) => (
              <div key={gi} className="md-tool-group">
                {group.map((t) => (
                  <Tip key={t.cmd} content={t.keys ? `${t.label()}  ${t.keys}` : t.label()}>
                    <RacButton
                      className={`icon-btn md-tool${active.has(t.cmd) ? ' is-on' : ''}`}
                      aria-label={t.label()}
                      aria-pressed={active.has(t.cmd)}
                      excludeFromTabOrder
                      onPress={() => run(t.cmd)}
                    >
                      {t.icon}
                    </RacButton>
                  </Tip>
                ))}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default MdEditor;
