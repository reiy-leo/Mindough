/**
 * 日记的输入框（Rei 2026-10-28 附图：深色圆角输入框，占位「What's on your mind? Capture it…」，底部左边图标，右边「Send」）。
 * - 左边：心情（可选，点一个再发；再点一次取消）、图片（走现有上传：登录并联网时传到 R2，插 ![](地址)）、列表（这一行前面加「- 」）。
 *   标签不做（Rei 2026-10-28「标签不做」），所以没有 # 按钮。
 * - 右边：发送（⌘/Ctrl + Enter 也发）。发了就不能改（Store 拦着），所以发送前不用确认。
 * 正文是 Markdown 纯文本，发出去的条目用 Markdown 组件显示。
 */
import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState, type CSSProperties, type ClipboardEvent, type KeyboardEvent } from 'react';
import { Button as RacButton } from 'react-aria-components';
import { ImagePlus, List, Send, Smile, X } from 'lucide-react';
import { MOOD_IDS, canSendPost, moodLabel, type MoodId } from '@mindough/core';
import { PopoverPanel, Tip } from '../../ui/primitives';
import { getAccount } from '../../lib/account';
import { normalizeImage } from '../../lib/image';
import { uploadImage } from '../../lib/upload';
import { useUi } from '../../lib/ui';
import { MoodIcon } from './MoodIcon';
import { tr } from '../../lib/i18n';

export interface ComposerHandle {
  focus: () => void;
}

/** 在光标所在行前面加「- 」（已经是列表就不加）；返回新文字和光标位置。导出给测试。 */
export function insertListMarker(text: string, caret: number): { text: string; caret: number } {
  const start = text.lastIndexOf('\n', Math.max(0, caret - 1)) + 1;
  const line = text.slice(start, text.indexOf('\n', start) === -1 ? text.length : text.indexOf('\n', start));
  if (/^\s*[-*+]\s/.test(line)) return { text, caret };
  return { text: `${text.slice(0, start)}- ${text.slice(start)}`, caret: caret + 2 };
}

/** 在光标处插一段（前后补空行，图片单独一段）。 */
function insertBlock(text: string, caret: number, block: string): { text: string; caret: number } {
  const before = text.slice(0, caret);
  const after = text.slice(caret);
  const pre = before && !before.endsWith('\n\n') ? (before.endsWith('\n') ? '\n' : '\n\n') : '';
  const post = after && !after.startsWith('\n') ? '\n\n' : '';
  const next = `${before}${pre}${block}${post}${after}`;
  return { text: next, caret: (before + pre + block).length };
}

export const JournalComposer = forwardRef<ComposerHandle, { onSend: (body: string, mood: MoodId | null) => void; autoFocus?: boolean }>(function JournalComposer({ onSend, autoFocus }, ref) {
  const ui = useUi();
  const [body, setBody] = useState('');
  const [mood, setMood] = useState<MoodId | null>(null);
  const [played, setPlayed] = useState(0);
  const [uploading, setUploading] = useState(0);
  const area = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const caretNext = useRef<number | null>(null);
  useImperativeHandle(ref, () => ({ focus: () => area.current?.focus() }), []);

  // 跟着内容长高（最多到 CSS 里的 max-height，再多就滚）
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
    if (caretNext.current !== null) {
      el.setSelectionRange(caretNext.current, caretNext.current);
      caretNext.current = null;
    }
  }, [body]);
  useLayoutEffect(() => {
    if (autoFocus) area.current?.focus();
  }, [autoFocus]);

  const canSend = canSendPost(body, mood) && uploading === 0;
  const send = () => {
    if (!canSend) return;
    onSend(body, mood);
    setBody('');
    setMood(null);
    area.current?.focus();
  };
  const edit = (fn: (text: string, caret: number) => { text: string; caret: number }) => {
    const el = area.current;
    const caret = el ? el.selectionStart : body.length;
    const r = fn(body, caret);
    caretNext.current = r.caret;
    setBody(r.text);
    el?.focus();
  };

  const putImages = async (files: File[]) => {
    const images = files.filter((f) => f.type.startsWith('image/'));
    if (!images.length) return;
    if (getAccount().status !== 'in' || navigator.onLine === false) {
      ui.toast({ tone: 'error', message: tr('登录并联网后才能把图片放进正文') }, 5000);
      return;
    }
    for (const f of images) {
      setUploading((n) => n + 1);
      try {
        const { blob } = await normalizeImage(f, null);
        const up = await uploadImage(blob);
        if (up) edit((text, caret) => insertBlock(text, caret, `![](${up.url})`));
        else ui.toast({ tone: 'error', message: tr('图片没传上去，稍后再试') }, 5000);
      } catch (err) {
        console.error('图片上传失败', err);
        ui.toast({ tone: 'error', message: tr('图片没传上去，稍后再试') }, 5000);
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...e.clipboardData.files];
    if (files.some((f) => f.type.startsWith('image/'))) {
      e.preventDefault();
      void putImages(files);
    }
  };

  const shortcut = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘↩' : 'Ctrl+Enter';
  return (
    <div className={`jcomposer${mood ? ' has-mood' : ''}`} style={mood ? ({ '--jm': `var(--mood-${mood})` } as CSSProperties) : undefined}>
      <textarea
        ref={area}
        className="jcomposer-input"
        aria-label={tr('写一条日记')}
        placeholder={tr('在想什么？记下来…')}
        rows={2}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={onKey}
        onPaste={onPaste}
      />
      <div className="jcomposer-bar">
        <PopoverPanel
          label={tr('选个心情')}
          className="jmood-pop"
          placement="bottom start"
          trigger={
            <RacButton className={`jcomposer-tool jcomposer-mood${mood ? ' is-set' : ''}`} aria-label={mood ? tr('心情：{label}', { label: moodLabel(mood) }) : tr('选个心情')}>
              {mood ? <MoodIcon key={played} mood={mood} size={22} playing={played > 0} /> : <Smile size={18} />}
              {mood && <span className="jcomposer-mood-name">{moodLabel(mood)}</span>}
            </RacButton>
          }
        >
          {(close) => (
            <div className="jmood-grid" role="group" aria-label={tr('心情')}>
              {MOOD_IDS.map((id) => (
                <RacButton
                  key={id}
                  className={`jmood-opt${mood === id ? ' is-selected' : ''}`}
                  aria-pressed={mood === id}
                  onPress={() => {
                    const next = mood === id ? null : id;
                    setMood(next);
                    if (next) setPlayed((n) => n + 1);
                    close();
                    requestAnimationFrame(() => area.current?.focus());
                  }}
                >
                  <MoodIcon mood={id} size={30} />
                  <span>{moodLabel(id)}</span>
                </RacButton>
              ))}
            </div>
          )}
        </PopoverPanel>
        {mood && (
          <RacButton className="jcomposer-tool jcomposer-clear" aria-label={tr('不选心情')} onPress={() => setMood(null)}>
            <X size={14} />
          </RacButton>
        )}
        <Tip content={tr('插入图片')}>
          <RacButton className="jcomposer-tool" aria-label={tr('插入图片')} isDisabled={uploading > 0} onPress={() => file.current?.click()}>
            <ImagePlus size={18} />
          </RacButton>
        </Tip>
        <Tip content={tr('列表')}>
          <RacButton className="jcomposer-tool" aria-label={tr('列表')} onPress={() => edit(insertListMarker)}>
            <List size={18} />
          </RacButton>
        </Tip>
        <input
          ref={file}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = '';
            void putImages(files);
          }}
        />
        <span className="grow" />
        {uploading > 0 && <span className="jcomposer-status muted small">{tr('图片上传中…')}</span>}
        <Tip content={tr('发送（{key}）', { key: shortcut })}>
          <RacButton className="jcomposer-send" isDisabled={!canSend} onPress={send}>
            <Send size={16} />
            <span>{tr('发送')}</span>
          </RacButton>
        </Tip>
      </div>
    </div>
  );
});
