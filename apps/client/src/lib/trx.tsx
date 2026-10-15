/**
 * 带元素的整句翻译：`trx('还有 {n} 天', { n: <b>{n}</b> })`。整句作为一个 key（中文原文），
 * 英文可以换语序（`{n} days to go`），元素照样插在对应位置；不再把句子拆成几段分别翻。
 * plain 里的值只用来填文字 / 给英文判断单复数（如 { n: 3 }），parts 里的是要插进去的元素。
 */
import { Fragment, type ReactNode } from 'react';
import { tr } from '@mindough/core';

const MARK = '\u0001';

export function trx(zh: string, parts: Record<string, ReactNode>, plain: Record<string, string | number> = {}, opts: { wrap?: string } = {}): ReactNode {
  const s = tr(zh, { ...plain, ...Object.fromEntries(Object.keys(parts).map((k) => [k, `${MARK}${k}${MARK}`])) });
  return s.split(MARK).map((seg, i) => {
    if (i % 2) return <Fragment key={i}>{parts[seg]}</Fragment>;
    if (opts.wrap === undefined) return seg;
    // 句子里的文字段各自包一层（.sentence 是 flex，文字和输入框之间留同样的间距）
    const t = seg.trim();
    return t ? <span key={i} className={opts.wrap || undefined}>{t}</span> : null;
  });
}
