import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { renderMarkdown } from '../lib/markdown';
import { katexReady, loadKatex, mayHaveMath } from '../lib/math';

import { tr } from '../lib/i18n';
/**
 * 只读的 Markdown。有公式（$…$）时按需加载 KaTeX（本地打包），加载好之前公式先显示源码。
 * 脚注的跳转（#md-fn-…）在这一块里面滚过去，不改地址栏（地址栏的 # 是路由）。
 */
export function Markdown({ source, className }: { source: string; className?: string }) {
  const needsMath = mayHaveMath(source);
  const [mathReady, setMathReady] = useState(katexReady);
  useEffect(() => {
    if (!needsMath || mathReady) return;
    let live = true;
    void loadKatex()
      .then(() => live && setMathReady(true))
      .catch((err) => console.error('加载公式渲染失败', err));
    return () => {
      live = false;
    };
  }, [needsMath, mathReady]);
  const html = useMemo(() => renderMarkdown(source), [source, mathReady && needsMath]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!source.trim()) return <div className={`md md-empty ${className ?? ''}`}>{tr('（还没有内容）')}</div>;
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const a = (e.target as HTMLElement).closest?.('a[href^="#md-fn-"]');
    if (!a) return;
    e.preventDefault();
    e.stopPropagation();
    const id = a.getAttribute('href')!.slice(1);
    const target = e.currentTarget.querySelector(`[id="${CSS.escape(id)}"]`);
    target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };
  return <div className={`md ${className ?? ''}`} onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** 写法提示（放在悬停提示里，不写在输入框下面）。函数：换语言后重新取文字。 */
export const markdownHelp = () => (
  <span className="md-help">
    {tr('直接这样写，会自动排好版：')}<br />
    <code>{tr('# 标题')}</code> <code>{tr('- [ ] 清单')}</code> <code>{tr('**粗体**')}</code>
  </span>
);
