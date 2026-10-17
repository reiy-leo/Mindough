// @vitest-environment happy-dom
/**
 * 只读显示里的 GitHub 扩展（Rei 2026-10-17）：提示块、数学公式（KaTeX）、脚注、表格对齐、<details>；价格不当公式。
 */
import { beforeAll, describe, expect, it } from 'vitest';
import katex from 'katex';
import { markdownHtml, renderMarkdown } from './markdown';
import { mayHaveMath, provideKatex, renderMath, validInlineMath } from './math';
import { parseAlertMarker } from './gh-alerts';

describe('提示块', () => {
  it('五种、大小写不敏感，标题与图标；Rei 的例子', () => {
    const html = markdownHtml('> [!NOTE]\n> 拒绝时提示 $O(n)$ 复杂度的环路径，方便定位。');
    expect(html).toContain('class="md-alert md-alert-note"');
    expect(html).toContain('<span>注意</span>');
    expect(html).not.toContain('[!NOTE]');
    expect(html).toContain('<p>拒绝时提示 ');
    const titles = { note: '注意', tip: '提示', important: '重要', warning: '警告', caution: '小心' };
    for (const [k, t] of Object.entries(titles)) {
      const h = markdownHtml(`> [!${k}]\n> 内容`);
      expect(h).toContain(`md-alert-${k}`);
      expect(h).toContain(`<span>${t}</span>`);
      expect(h).toContain('<svg');
    }
  });

  it('只有标记、后面接列表；旧的 \\[!NOTE] 也认', () => {
    expect(markdownHtml('> [!WARNING]\n> - a')).toMatch(/md-alert-warning[\s\S]*<ul>\s*<li>a<\/li>/);
    expect(markdownHtml('> [!TIP]')).toContain('md-alert-tip');
    expect(markdownHtml('> \\[!NOTE]\n> 旧')).toContain('md-alert-note');
  });

  it('不是提示块：同一行还有字、普通引用', () => {
    expect(markdownHtml('> [!NOTE] 同一行')).toContain('<blockquote>');
    expect(markdownHtml('> 普通')).toContain('<blockquote>');
    expect(parseAlertMarker('[!nope]')).toBeNull();
    expect(parseAlertMarker('[!Tip]\n后')).toEqual({ kind: 'tip', marker: 'Tip', rest: '后' });
  });

  it('消毒后图标和类名还在', () => {
    // happy-dom 里 DOMPurify 会丢掉开头第一个元素（浏览器里没有这个问题）：前面垫一段
    const html = renderMarkdown('前\n\n> [!CAUTION]\n> 小心');
    expect(html).toContain('md-alert-caution');
    expect(html).toContain('<svg');
  });
});

describe('数学公式', () => {
  it('KaTeX 没加载：先显示源码占位', () => {
    expect(markdownHtml('看 $x^2$')).toContain('<code class="md-math-pending">x^2</code>');
  });

  describe('加载后', () => {
    beforeAll(() => provideKatex(katex));

    it('行内、$$ 行内、块级 $$、```math', () => {
      expect(markdownHtml('看 $O(n)$ 吧')).toMatch(/看 <span class="katex">[\s\S]*<\/span> 吧/);
      expect(markdownHtml('$$x$$')).toContain('katex');
      const block = markdownHtml('前\n\n$$\nx^2 + y^2\n$$\n\n后');
      expect(block).toContain('class="md-math-block"');
      expect(block).toContain('katex-display');
      expect(block).toMatch(/<p>后<\/p>/);
      expect(markdownHtml('```math\n\\frac12\n```')).toContain('katex-display');
    });

    it('价格不当公式（GitHub 规则）', () => {
      for (const s of ['价格 $5 和 $10', '$5和$10', '$ x $', '花了 $5，还剩 $', 'US$100 和 US$200']) expect(markdownHtml(s)).not.toContain('katex');
      expect(markdownHtml('\\$x\\$')).not.toContain('katex');
      expect(markdownHtml('`$x$`')).toContain('<code>$x$</code>');
    });

    it('写错的公式不报错', () => {
      expect(() => markdownHtml('$\\frac{$')).not.toThrow();
      expect(renderMath('\\badcommand', false)).toContain('katex');
    });

    it('消毒后公式还在（MathML + HTML）', () => {
      const html = renderMarkdown('$a^2$');
      expect(html).toContain('katex-html');
      expect(html).toContain('<math');
    });
  });

  it('validInlineMath / mayHaveMath', () => {
    expect(validInlineMath('x', ' ')).toBe(true);
    expect(validInlineMath(' x', undefined)).toBe(false);
    expect(validInlineMath('x ', undefined)).toBe(false);
    expect(validInlineMath('5和', '1')).toBe(false);
    expect(mayHaveMath('没有')).toBe(false);
    expect(mayHaveMath('$x$')).toBe(true);
  });
});

describe('其他 GitHub 语法', () => {
  it('脚注', () => {
    const html = markdownHtml('文字[^1]\n\n[^1]: 脚注内容');
    expect(html).toContain('href="#md-fn-1"');
    expect(html).toContain('class="footnotes"');
    expect(html).toContain('脚注内容');
  });

  it('表格对齐、清单、删除线、自动链接、<details>', () => {
    const t = markdownHtml('| a | b | c |\n|:-|:-:|-:|\n| 1 | 2 | 3 |');
    expect(t).toContain('align="left"');
    expect(t).toContain('align="center"');
    expect(t).toContain('align="right"');
    expect(markdownHtml('- [x] 好')).toContain('checkbox');
    expect(markdownHtml('~~删~~')).toContain('<del>');
    expect(markdownHtml('见 https://a.com')).toContain('href="https://a.com"');
    const d = renderMarkdown('前\n\n<details><summary>看</summary>\n\n内容\n</details>');
    expect(d).toContain('<details>');
    expect(d).toContain('<summary>看</summary>');
  });
});

describe('和编辑器同样的配对', () => {
  beforeAll(() => provideKatex(katex));
  it('「$5 和 $10 不是公式；$E=mc^2$ 是」：只有最后一对是公式', () => {
    const html = markdownHtml('价格 $5 和 $10 不是公式；$E=mc^2$ 是。');
    expect(html).toMatch(/^<p>价格 \$5 和 \$10 不是公式；<span class="katex">/);
    expect((html.match(/class="katex"/g) ?? []).length).toBe(1);
    expect(markdownHtml('a $5 <b> $')).toContain('&lt;b&gt;');
  });
});
