/**
 * Markdown 所见即所得编辑器（任务内容、资料 / 人物备注）。写的时候就是排好版的样子，存的还是 markdown。
 *
 * - 写法：直接打 markdown 也会变（「# 」标题、「- 」列表、「[ ] 」清单、「> 」引用、「```」代码、**粗体**…）。
 * - 没有工具栏（Rei 2026-10-25「换成tiptap后，不用显示toolbar」）：格式靠快捷键（⌘B / ⌘I / ⌘⌥X / ⌘⌥1–6 / ⌘⌥8 / ⌘⌥7 / ⌘⇧B / ⌘⌥C）
 *   和手打语法（清单 `[] `、表格 `|3x2| `、折叠块 `<details>` 回车、提示块 `> [!NOTE]`、公式 `$…$`）。⌘K / Ctrl+K 加链接，Esc 收起。
 * - 悬停不变底色（Rei 2026-10-25「hover编辑器不用change bg」），聚焦也不变；只有光标。备注框（.note-editor）聚焦时边框照旧变强调色。
 * - 链接（Rei 2026-10-17「放上去就展示吧，点一下是访问链接」）：点一下打开（Web 新标签页，App 交给系统浏览器）；
 *   鼠标移到链接上出现小浮层：原地址 +「编辑」「去掉链接」，鼠标能移进浮层，移开收起。
 *   触屏没有悬停：长按选中链接里的字（光标 / 选区落在链接里）出同一个浮层。
 * - 链接框（Rei 2026-10-17「编辑器中链接要支持编辑名称和链接」）：浮层「编辑」、⌘K 都开同一个框，
 *   桌面：就是那个悬停浮层原地展开（新加时锚在光标 / 选区处），不是居中弹窗；触屏：底部弹出面板，键盘弹起时跟着抬高、留出安全区。
 *   两栏「文字」「链接」：在已有链接里 = 预填两栏、保存时整段换掉；选了字 = 预填文字；文字空着就用网址当名字；
 *   网址没协议补 https://，不像网址就在框里提示、不关。回车保存（输入法选字的回车不算）、Esc 取消，Tab 只在框里转。
 *   点框外面 = 取消。
 * - 外面的值变了（同步下来）且不是自己刚写的：替换内容。
 * - 粘贴 / 拖进正文的图片：拦下、不上传，提示「正文里不能放图片」（Rei 2026-10-29）。拖到正文外面的文件仍是附件，见 Attachments.tsx useFileDrop。
 * 内核是 Tiptap 3（@tiptap/react 的 useEditor + EditorContent，Rei 2026-10-25 从 Milkdown 换过来），读写 markdown 见 editor.ts / markdown.ts。
 * 这个文件按需加载（LazyMdEditor），加载完之前显示排好版的预览。
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { Button as RacButton, Input, Label, TextField } from 'react-aria-components';
import { tr } from '../../lib/i18n';
import { externalHref, openExternal } from '../../lib/external';
import { useUiOptional } from '../../lib/ui';
import { MdController, normalizeHref, stopTab, type LinkRange, type MdEditorHandle, type MdEditorOptions } from './editor';

export interface MdEditorProps {
  value: string;
  onChange: (md: string) => void;
  label: string;
  placeholder?: string;
  autoFocus?: boolean;
  onBlur?: () => void;
  onEscape?: () => void;
  className?: string;
  /** 只读：能看、能点链接，不能改。 */
  readOnly?: boolean;
}

/** 链接框：改哪一段（新加时是选区 / 光标）、是不是已有的链接、两栏的值。 */
interface LinkDialog {
  range: { from: number; to: number };
  existing: LinkRange | null;
  text: string;
  href: string;
  /** 选区跨了段落：文字不能改，只加链接。 */
  textLocked: boolean;
  error: '' | 'empty' | 'bad';
  /** 触屏：底部弹出面板（避开键盘和安全区）；鼠标 / 键盘：锚在链接 / 光标旁的浮层。 */
  sheet: boolean;
}

/** 输入法正在选字时的回车（Safari 选完字的那次 keydown 是 229）不算保存。 */
const composing = (e: React.KeyboardEvent) => e.nativeEvent.isComposing || e.keyCode === 229;

export function MdEditor({ value, onChange, label, placeholder = '', autoFocus, onBlur, onEscape, className, readOnly = false }: MdEditorProps) {
  const ui = useUiOptional();
  const handle = useRef<MdEditorHandle | null>(null);
  const cb = useRef({ onChange, onBlur, onEscape });
  cb.current = { onChange, onBlur, onEscape };
  const [focused, setFocused] = useState(false);
  const [dialog, setDialog] = useState<LinkDialog | null>(null);
  /** 鼠标指着的链接；光标 / 选区所在的链接（触屏、键盘）。 */
  const [hover, setHover] = useState<LinkRange | null>(null);
  const [selLink, setSelLink] = useState<LinkRange | null>(null);
  const [popPos, setPopPos] = useState<{ left: number; top: number } | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const touch = useRef(false);
  const wrap = useRef<HTMLDivElement>(null);
  const popEl = useRef<HTMLDivElement>(null);
  const hrefInput = useRef<HTMLInputElement>(null);
  const textInput = useRef<HTMLInputElement>(null);
  const linkingRef = useRef(false);
  linkingRef.current = !!dialog;

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

  /** 开链接框：给了链接 = 改它；否则看选区（在链接里 = 改那条；选了字 = 预填文字；空光标 = 新加）。 */
  const openLinkForm = (existing?: LinkRange) => {
    const h = handle.current;
    if (!h) return;
    const sel = h.selection(); // 先把 DOM 上刚改的选区读进来
    const cur = existing ?? h.linkAtSelection();
    const range = cur ? { from: cur.from, to: cur.to } : sel;
    const st = h.view().state;
    let textLocked = false;
    try {
      textLocked = !st.doc.resolve(range.from).sameParent(st.doc.resolve(range.to));
    } catch {
      /* 范围过期了：当普通的 */
    }
    const text = h.textOf(range);
    // 选中的字本身像网址：顺手填进「链接」
    const href = cur?.href ?? (/^(https?:\/\/|www\.)\S+$/i.test(text.trim()) && normalizeHref(text) ? text.trim() : '');
    setHover(null);
    const coarse = typeof matchMedia === 'function' && matchMedia('(hover: none) and (pointer: coarse)').matches;
    setDialog({ range, existing: cur, text, href, textLocked, error: '', sheet: touch.current || coarse });
  };
  const openRef = useRef(openLinkForm);
  openRef.current = openLinkForm;
  const initial = useRef(value);

  const optsRef = useRef<MdEditorOptions>(null as unknown as MdEditorOptions);
  optsRef.current = {
    value: initial.current,
    label,
    placeholder,
    readOnly,
    onChange: (md) => cb.current.onChange(md),
    onFocus: () => setFocused(true),
    onBlur: () => {
      // 点链接框里的输入框不算离开
      setTimeout(() => {
        if (linkingRef.current || wrap.current?.contains(document.activeElement)) return;
        setFocused(false);
        cb.current.onBlur?.();
      }, 0);
    },
    onEscape: () => cb.current.onEscape?.(),
    onLinkShortcut: () => openRef.current(),
    onSelection: () => {
      const h = handle.current;
      if (!h) return;
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
    onImageBlocked: () => ui?.toast({ message: tr('正文里不能放图片') }, 4000),
  };
  const ctl = useMemo(() => new MdController(() => optsRef.current), []);
  // 编辑器只建一次（官方 useEditor）；value 的变化走下面的 setMarkdown
  const editor = useEditor({ ...ctl.options(), immediatelyRender: true, shouldRerenderOnTransaction: false }, []);
  useEffect(() => {
    if (!editor) return;
    ctl.attach(editor);
    handle.current = ctl.handle();
    if (autoFocus && !readOnly) editor.commands.focus('end', { scrollIntoView: false });
    return () => {
      handle.current = null;
    };
  }, [editor]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (editor && editor.isEditable === readOnly) editor.setEditable(!readOnly, false);
  }, [editor, readOnly]);

  // Tab 不冒泡到弹层的焦点圈（见 editor.ts stopTab）
  useEffect(() => (wrap.current ? stopTab(wrap.current) : undefined), []);

  useEffect(() => {
    handle.current?.setMarkdown(value);
  }, [value]);

  /** 关链接框。refocus：回到编辑器；点了编辑器外面就补上刚才压住的 onBlur。 */
  const closeDialog = (refocus = true) => {
    setDialog(null);
    setHover(null);
    if (refocus) return void handle.current?.focus();
    setTimeout(() => {
      if (wrap.current?.contains(document.activeElement)) return;
      setFocused(false);
      cb.current.onBlur?.();
    }, 0);
  };

  const saveLink = () => {
    const h = handle.current;
    const d = dialog;
    if (!h || !d) return;
    if (!d.href.trim()) return void (setDialog({ ...d, error: 'empty' }), hrefInput.current?.focus());
    if (!h.applyLink(d.range, d.textLocked ? h.textOf(d.range) : d.text, d.href)) {
      setDialog({ ...d, error: 'bad' });
      hrefInput.current?.focus();
      return;
    }
    closeDialog();
  };

  const removeLink = (range: LinkRange) => {
    const h = handle.current;
    if (!h) return;
    h.setLink(range, '');
    setHover(null);
    setDialog(null);
    h.focus();
  };

  // 链接框打开时把焦点放进去：选了字的新链接 / 文字改不了 → 「链接」；其余 → 「文字」。
  // 等这一下键盘事件（⌘K）走完再放，不然编辑器会把焦点拿回去。
  const dialogOpen = dialog != null;
  useEffect(() => {
    if (!dialog) return;
    const toHref = dialog.textLocked || (!!dialog.text && !dialog.existing);
    const id = requestAnimationFrame(() => (toHref ? hrefInput : textInput).current?.focus());
    return () => cancelAnimationFrame(id);
  }, [dialogOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // 底部面板：键盘弹起时（visualViewport 变矮）把面板抬到键盘上面
  const [kbInset, setKbInset] = useState(0);
  const sheetOpen = !!dialog?.sheet;
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!sheetOpen || !vv) return setKbInset(0);
    const sync = () => setKbInset(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)));
    sync();
    vv.addEventListener('resize', sync);
    vv.addEventListener('scroll', sync);
    return () => {
      vv.removeEventListener('resize', sync);
      vv.removeEventListener('scroll', sync);
    };
  }, [sheetOpen]);

  // 链接框开着：点框外面 = 取消（点在编辑器里就留在编辑器，点在外面就算离开编辑器）
  useEffect(() => {
    if (!dialog) return;
    const down = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (!t || popEl.current?.contains(t)) return;
      closeDialog(false);
    };
    document.addEventListener('pointerdown', down, true);
    return () => document.removeEventListener('pointerdown', down, true);
  }, [dialogOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  /** 框里的 Tab / Shift+Tab 只在两栏和按钮之间转，不让焦点跑出去（外面的弹层焦点圈也收不到）。 */
  const trapTab = (e: React.KeyboardEvent<HTMLFormElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeDialog();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('input:not([disabled]), button:not([disabled])'));
    if (!items.length) return;
    e.preventDefault();
    e.stopPropagation();
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next = e.shiftKey ? (at <= 0 ? items.length - 1 : at - 1) : at < 0 || at === items.length - 1 ? 0 : at + 1;
    items[next]!.focus();
  };
  const enterSaves = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault(); // 不走表单的隐式提交：输入法选字的回车也会触发它
    if (!composing(e)) saveLink();
  };

  // 浮层：链接框 > 鼠标指着的 > 光标所在的（编辑器有焦点时）
  const anchor = dialog?.range ?? hover ?? (focused ? selLink : null);
  const pop = dialog ? null : (hover ?? (focused ? selLink : null));
  useLayoutEffect(() => {
    if (!anchor || !wrap.current || !handle.current) return setPopPos(null);
    const c = handle.current.coordsOf(anchor);
    const box = wrap.current.getBoundingClientRect();
    if (!c) return setPopPos(null);
    // 先不可见地排一次量宽度，再贴着编辑器右边收进来（手机上别撑出横向滚动）
    const w = Math.min(popEl.current?.offsetWidth ?? 240, box.width);
    const left = Math.max(0, Math.min(c.left - box.left, box.width - w));
    setPopPos({ left, top: c.bottom - box.top + 4 });
  }, [anchor?.from, anchor?.to, pop?.href, dialog != null]); // eslint-disable-line react-hooks/exhaustive-deps

  const linkForm = dialog && (
    <form
      className="md-link-dialog"
      role="dialog"
      aria-label={dialog.existing ? tr('编辑链接') : tr('添加链接')}
      onKeyDown={trapTab}
      onSubmit={(e) => {
        e.preventDefault();
        saveLink();
      }}
    >
      <TextField
        className="md-link-row"
        value={dialog.text}
        onChange={(v) => setDialog({ ...dialog, text: v })}
        isDisabled={dialog.textLocked}
      >
        <Label className="md-link-label">{tr('文字')}</Label>
        <Input ref={textInput} className="input md-link-input" placeholder={tr('不填就用网址')} onFocus={(e) => e.currentTarget.select()} onKeyDown={enterSaves} />
      </TextField>
      <TextField
        className="md-link-row"
        value={dialog.href}
        onChange={(v) => setDialog({ ...dialog, href: v, error: '' })}
        isInvalid={!!dialog.error}
      >
        <Label className="md-link-label">{tr('链接')}</Label>
        <Input
          ref={hrefInput}
          className="input md-link-input"
          placeholder="https://"
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={enterSaves}
          aria-describedby={dialog.error ? 'md-link-err' : undefined}
        />
      </TextField>
      {dialog.error && (
        <div id="md-link-err" className="md-link-error" role="alert">
          {dialog.error === 'empty' ? tr('填一个网址') : tr('这不像网址，检查一下')}
        </div>
      )}
      <div className="md-link-actions">
        {dialog.existing && (
          <RacButton className="btn btn-quiet btn-sm md-link-remove" onPress={() => removeLink(dialog.existing!)}>
            {tr('去掉链接')}
          </RacButton>
        )}
        <RacButton className="btn btn-quiet btn-sm" onPress={() => closeDialog()}>
          {tr('取消')}
        </RacButton>
        <RacButton type="submit" className="btn btn-primary btn-sm">
          {dialog.existing ? tr('保存') : tr('添加')}
        </RacButton>
      </div>
    </form>
  );

  return (
    <div
      ref={wrap}
      className={`md-editor${!readOnly && (focused || dialog) ? ' is-focused' : ''}${className ? ` ${className}` : ''}`}
      onPointerDownCapture={(e) => (touch.current = e.pointerType === 'touch' || e.pointerType === 'pen')}
      onPointerMoveCapture={(e) => e.pointerType === 'mouse' && (touch.current = false)}
    >
      <EditorContent editor={editor} className="md-editor-root" />
      {(pop || (dialog && !dialog.sheet)) && (
        <div
          ref={popEl}
          className={`md-link-pop${dialog ? ' is-editing' : ''}`}
          style={popPos ? { left: popPos.left, top: popPos.top } : { left: 0, top: 0, visibility: 'hidden' }}
          onMouseEnter={cancelHide}
          onMouseLeave={() => !dialog && hover && scheduleHide()}
          onMouseDown={(e) => !(e.target as HTMLElement).closest('input') && e.preventDefault()}
        >
          {dialog && !dialog.sheet ? (
            linkForm
          ) : pop ? (
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
              <RacButton className="btn btn-quiet btn-sm" onPress={() => openLinkForm(pop)}>
                {tr('编辑')}
              </RacButton>
              <RacButton className="btn btn-quiet btn-sm" onPress={() => removeLink(pop)}>
                {tr('去掉链接')}
              </RacButton>
            </>
          ) : null}
        </div>
      )}
      {dialog?.sheet && (
        <>
          <div className="md-link-sheet-backdrop" aria-hidden />
          <div
            ref={popEl}
            className="md-link-sheet"
            style={kbInset ? { bottom: kbInset, paddingBottom: 12 } : undefined}
            onMouseDown={(e) => !(e.target as HTMLElement).closest('input') && e.preventDefault()}
          >
            <div className="md-link-sheet-title" aria-hidden>
              {dialog.existing ? tr('编辑链接') : tr('添加链接')}
            </div>
            {linkForm}
          </div>
        </>
      )}
    </div>
  );
}

export default MdEditor;
