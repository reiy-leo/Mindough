import { useMemo } from 'react';
import { renderMarkdown } from '../lib/markdown';

export function Markdown({ source, className }: { source: string; className?: string }) {
  const html = useMemo(() => renderMarkdown(source), [source]);
  if (!source.trim()) return <div className={`md md-empty ${className ?? ''}`}>（还没有内容）</div>;
  return <div className={`md ${className ?? ''}`} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** 写法提示（放在悬停提示里，不写在输入框下面）。 */
export const MARKDOWN_HELP = (
  <span className="md-help">
    可以用 Markdown 排版：
    <br />
    <code># 标题</code> <code>- [ ] 清单</code> <code>**粗体**</code>
  </span>
);
