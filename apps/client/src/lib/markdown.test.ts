import { describe, expect, it } from 'vitest';
import { markdownHtml } from './markdown';

describe('备注 / 内容的 Markdown', () => {
  it('老的纯文字备注照原样分行', () => {
    expect(markdownHtml('第一行\n第二行')).toBe('<p>第一行<br>第二行</p>\n');
  });

  it('清单、列表、引用、代码、表格都能排版', () => {
    const html = markdownHtml('- [ ] 买票\n- [x] 订座\n\n> 好看\n\n`code`\n\n```\nblock\n```\n\n| 平台 | 价格 |\n| --- | --- |\n| Steam | 58 |\n');
    expect(html).toContain('<input disabled="" type="checkbox">');
    expect(html).toContain('<input checked="" disabled="" type="checkbox">');
    expect(html).toContain('<blockquote>');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('<pre><code>block');
    expect(html).toContain('<table>');
    expect(html).toContain('<td>Steam</td>');
  });

  it('链接（含自动识别的网址）在新标签页打开', () => {
    expect(markdownHtml('[豆瓣](https://movie.douban.com/subject/1889243/)')).toContain('<a href="https://movie.douban.com/subject/1889243/" target="_blank" rel="noopener noreferrer">豆瓣</a>');
    expect(markdownHtml('看这里 https://ext.to/x')).toContain('target="_blank"');
  });
});
