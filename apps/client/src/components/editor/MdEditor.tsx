/**
 * Markdown 所见即所得编辑器（任务内容、资料 / 人物备注）。写的时候就是排好版的样子，存的还是 markdown。
 *
 * - 写法：直接打 markdown 也会变（「# 」标题、「- 」列表、「[ ] 」清单、「> 」引用、「```」代码、**粗体**…）。
 * - 工具栏：编辑时在下方出现一排小按钮（放下面，点进来时文字不跳）（标题 / 粗体 / 斜体 / 删除线 / 清单 / 列表 / 编号 / 引用 / 代码 / 链接 / 表格），
 *   按钮不抢焦点；悬停提示带快捷键。⌘K / Ctrl+K 加链接，Esc 收起。
 * - 链接（Rei 2026-10-17「放上去就展示吧，点一下是访问链接」）：点一下打开（Web 新标签页，App 交给系统浏览器）；
 *   鼠标移到链接上出现小浮层：原地址 +「编辑」（预填原地址，回车保存）「去掉链接」，鼠标能移进浮层，移开收起。
 *   触屏没有悬停：长按选中链接里的字（光标 / 选区落在链接里）出同一个浮层。⌘K 在链接里 = 改这条链接（预填）。
 * - 外面的值变了（同步下来）且不是自己刚写的：替换内容。
 * 这个文件按需加载（LazyMdEditor），加载完之前显示排好版的预览。
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Bold, Code, Heading, Italic, Link2, List, ListChecks, ListOrdered, Quote, Strikethrough, Table } from 'lucide-react';
import { Button as RacButton, Input, TextField } from 'react-aria-components';
import { Tip } from '../../ui/primitives';
import { tr } from '../../lib/i18n';
import { externalHref, openExternal } from '../../lib/external';
import { createMdEditor, withProtocol, type LinkRange, type MdCommand, type MdEditorHandle } from './milkdown';
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
  /** 工具栏链接框在改哪条已有链接（null = 新加）。 */
  const [linkTarget, setLinkTarget] = useState<LinkRange | null>(null);
  /** 鼠标指着的链接；光标 / 选区所在的链接（触屏、键盘）。 */
  const [hover, setHover] = useState<LinkRange | null>(null);
  const [selLink, setSelLink] = useState<LinkRange | null>(null);
  /** 浮层里正在改的那条（改的时候浮层不收）。 */
  const [editing, setEditing] = useState<{ range: LinkRange; href: string } | null>(null);
  const [popPos, setPopPos] = useState<{ left: number; top: number } | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const touch = useRef(false);
  const wrap = useRef<HTMLDivElement>(null);
  const popEl = useRef<HTMLDivElement>(null);
  const linkingRef = useRef(false);
  linkingRef.current = linking || !!editing;

  const cancelHide = () => clearTimeout(hideTimer.current);
  const scheduleHide = () => {
    cancelHide();
    hideTimer.current = setTimeout(() => setHover(null), 250);
  };
  useEffect(() => () => clearTimeout(hideTimer.current), []);

  /** 打开链接：别的源 / mailto / tel 走 openExternal（App 里系统浏览器，Web 新标签页 noopener）；同源的 #/ 路由就地跳。 */
  const openLink = (raw: string) => {
    const url = externalHref(raw, window.location.origin);
    if (url) return void openExternal(url).catch((err) => console.error('打开链接失败', err));
    if (raw.startsWith('#')) window.location.hash = raw;
  };

  /** 工具栏 / ⌘K 打开链接框：在已有链接里就预填它的地址、保存时改它。 */
  const openLinkForm = () => {
    const cur = handle.current?.linkAtSelection() ?? null;
    setLinkTarget(cur);
    setHref(cur?.href ?? '');
    setLinking(true);
  };
  const openRef = useRef(openLinkForm);
  openRef.current = openLinkForm;
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
      ...(toolbar === 'none' ? {} : { onLinkShortcut: () => openRef.current() }),
      onSelection: () => {
        if (!h) return;
        setActive(h.active());
        setSelLink(h.linkAtSelection());
      },
      onLinkHover: (r) => {
        if (touch.current) return; // 触屏的点按会先补一个 mouseover：不当悬停
        if (r) {
          cancelHide();
          setHover(r);
        } else scheduleHide();
      },
      onLinkOpen: (u) => openLink(u),
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
      openLinkForm();
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
    const target = linkTarget;
    setLinking(false);
    setHref('');
    setLinkTarget(null);
    if (!h) return;
    h.focus();
    if (target) {
      // 改已有的：清空了也不去掉（去掉有自己的按钮），只在有地址时更新
      if (url) h.setLink(target, url);
    } else if (url) h.run('link', withProtocol(url));
  };

  const removeLink = (range: LinkRange) => {
    const h = handle.current;
    if (!h) return;
    h.setLink(range, '');
    setHover(null);
    setEditing(null);
    setLinking(false);
    setLinkTarget(null);
    h.focus();
  };

  const saveEdit = () => {
    const h = handle.current;
    const e = editing;
    setEditing(null);
    setHover(null);
    if (!h || !e) return;
    const url = e.href.trim();
    if (url) h.setLink(e.range, url);
    h.focus();
  };

  // 浮层：正在改的 > 鼠标指着的 > 光标所在的（编辑器有焦点时；工具栏链接框开着时不出）
  const pop = editing?.range ?? hover ?? (focused && !linking ? selLink : null);
  useLayoutEffect(() => {
    if (!pop || !wrap.current || !handle.current) return setPopPos(null);
    const c = handle.current.coordsOf(pop);
    const box = wrap.current.getBoundingClientRect();
    if (!c) return setPopPos(null);
    // 先不可见地排一次量宽度，再贴着编辑器右边收进来（手机上别撑出横向滚动）
    const w = Math.min(popEl.current?.offsetWidth ?? 240, box.width);
    const left = Math.max(0, Math.min(c.left - box.left, box.width - w));
    setPopPos({ left, top: c.bottom - box.top + 4 });
  }, [pop?.from, pop?.to, pop?.href, editing != null]); // eslint-disable-line react-hooks/exhaustive-deps

  const showBar = toolbar !== 'none' && (toolbar === 'always' || focused || linking);
  return (
    <div
      ref={wrap}
      className={`md-editor${showBar ? ' is-active' : ''}${className ? ` ${className}` : ''}`}
      onPointerDownCapture={(e) => (touch.current = e.pointerType === 'touch' || e.pointerType === 'pen')}
      onPointerMoveCapture={(e) => e.pointerType === 'mouse' && (touch.current = false)}
    >
      <div ref={root} className="md-editor-root" />
      {pop && (
        <div
          ref={popEl}
          className={`md-link-pop${editing ? ' is-editing' : ''}`}
          style={popPos ? { left: popPos.left, top: popPos.top } : { left: 0, top: 0, visibility: 'hidden' }}
          onMouseEnter={cancelHide}
          onMouseLeave={() => !editing && hover && scheduleHide()}
          onMouseDown={(e) => !(e.target as HTMLElement).closest('input') && e.preventDefault()}
        >
          {editing ? (
            <form
              className="md-link-form"
              onSubmit={(e) => {
                e.preventDefault();
                saveEdit();
              }}
            >
              <Link2 size={15} aria-hidden className="muted" />
              <TextField aria-label={tr('链接地址')} value={editing.href} onChange={(v) => setEditing({ ...editing, href: v })} autoFocus className="md-link-field">
                <Input
                  className="input md-link-input"
                  placeholder="https://"
                  onFocus={(e) => e.currentTarget.select()}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      e.stopPropagation();
                      setEditing(null);
                      setHover(null);
                      handle.current?.focus();
                    }
                  }}
                />
              </TextField>
              <RacButton type="submit" className="btn btn-quiet btn-sm">
                {tr('保存')}
              </RacButton>
            </form>
          ) : (
            <>
              <a
                className="md-link-pop-url"
                href={pop.href}
                title={pop.href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => {
                  if (e.defaultPrevented) return; // App 里全局外链拦截已经交给系统浏览器了
                  e.preventDefault();
                  openLink(pop.href);
                }}
              >
                {pop.href}
              </a>
              <RacButton className="btn btn-quiet btn-sm" onPress={() => setEditing({ range: pop, href: pop.href })}>
                {tr('编辑')}
              </RacButton>
              <RacButton className="btn btn-quiet btn-sm" onPress={() => removeLink(pop)}>
                {tr('去掉链接')}
              </RacButton>
            </>
          )}
        </div>
      )}
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
                      setLinkTarget(null);
                      handle.current?.focus();
                    }
                  }}
                />
              </TextField>
              <RacButton type="submit" className="btn btn-quiet btn-sm">
                {linkTarget ? tr('保存') : tr('添加')}
              </RacButton>
              {linkTarget && (
                <RacButton className="btn btn-quiet btn-sm" onPress={() => removeLink(linkTarget)}>
                  {tr('去掉链接')}
                </RacButton>
              )}
              <RacButton
                className="btn btn-quiet btn-sm"
                onPress={() => {
                  setLinking(false);
                  setLinkTarget(null);
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
