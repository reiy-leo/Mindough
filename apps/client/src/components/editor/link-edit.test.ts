// @vitest-environment happy-dom
/**
 * 链接框：文字 + 网址一起改（Rei 2026-10-17「编辑器中链接要支持编辑名称和链接」）。
 * 保存后写出的 markdown 读回来还是同一条链接（往返稳定）。
 */
import { describe, expect, it } from 'vitest';
import { TextSelection } from '@milkdown/kit/prose/state';
import { createMdEditor, normalizeHref, roundTrip, type MdEditorHandle } from './milkdown';

const setup = async (md: string) => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const h = await createMdEditor({ root, value: md, placeholder: '', label: 'x', onChange: () => {} });
  return {
    h,
    done: async () => {
      await h.destroy();
      root.remove();
    },
  };
};
const posOf = (h: MdEditorHandle, text: string, offset = 0) => {
  let at = -1;
  h.view().state.doc.descendants((n, pos) => {
    if (at < 0 && n.isText && n.text?.includes(text)) at = pos + n.text.indexOf(text) + offset;
  });
  return at;
};
const linkAt = (h: MdEditorHandle, text: string) => {
  const v = h.view();
  v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, posOf(h, text, 1))));
  return h.linkAtSelection()!;
};
/** 写出去的 markdown 再读一遍不变。 */
const stable = async (md: string) => expect(await roundTrip(md)).toBe(md);

describe('normalizeHref', () => {
  it('补 https://、留协议、站内 #/ 照原样', () => {
    expect(normalizeHref('example.com')).toBe('https://example.com');
    expect(normalizeHref('  https://a.com/x  ')).toBe('https://a.com/x');
    expect(normalizeHref('http://localhost:5173/')).toBe('http://localhost:5173/');
    expect(normalizeHref('mailto:rei@x.com')).toBe('mailto:rei@x.com');
    expect(normalizeHref('#/task/abc')).toBe('#/task/abc');
    expect(normalizeHref('//cdn.x.com/a')).toBe('https://cdn.x.com/a');
    expect(normalizeHref('例子.中国/页')).toBe('https://例子.中国/页');
  });
  it('中间的空格编成 %20；括号留着', () => {
    expect(normalizeHref('https://a.com/my file.pdf')).toBe('https://a.com/my%20file.pdf');
    expect(normalizeHref('https://zh.wikipedia.org/wiki/沙丘_(小说)')).toBe('https://zh.wikipedia.org/wiki/沙丘_(小说)');
  });
  it('不像网址的不收', () => {
    for (const bad of ['', '   ', 'hello', 'https://', 'javascript:alert(1)', 'data:text/html,x', 'mailto:', 'a..b.com', '.com'])
      expect(normalizeHref(bad), bad).toBeNull();
  });
});

describe('链接框保存：文字和网址一起改', () => {
  it('改已有链接的文字和网址：整段换掉', async () => {
    const { h, done } = await setup('看 [文档](https://old.com) 吧');
    const r = linkAt(h, '文档');
    expect(h.textOf(r)).toBe('文档');
    expect(h.applyLink(r, '新的说明文档', 'new.com/a')).toBe(true);
    const md = h.getMarkdown();
    expect(md).toBe('看 [新的说明文档](https://new.com/a) 吧\n');
    await stable(md);
    await done();
  });

  it('只改网址：保留链接里的粗体（写法和读进来时一样）', async () => {
    const md0 = '[**粗**和细](https://a.com)';
    const { h, done } = await setup(md0);
    const r = linkAt(h, '和');
    expect(h.textOf(r)).toBe('粗和细');
    h.applyLink(r, '粗和细', 'b.com');
    // milkdown 本来就把它写成 **[粗](…)**[和细](…)（同一个意思）；这里只要求和不改文字时一样、且稳定
    const md = h.getMarkdown();
    expect(md).toBe((await roundTrip(md0)).replaceAll('https://a.com', 'https://b.com'));
    expect(md).toContain('**');
    await stable(md);
    await done();
  });

  it('文字留空：用网址当名称', async () => {
    const { h, done } = await setup('[文档](https://old.com)');
    const r = linkAt(h, '文档');
    h.applyLink(r, '  ', 'x.com/p');
    const md = h.getMarkdown();
    expect(md).toBe('<https://x.com/p>\n');
    await stable(md);
    await done();
  });

  it('网址不对：返回 false，什么都不改', async () => {
    const { h, done } = await setup('[文档](https://old.com)');
    const r = linkAt(h, '文档');
    expect(h.applyLink(r, '新名字', 'not a url')).toBe(false);
    expect(h.getMarkdown()).toBe('[文档](https://old.com)\n');
    await done();
  });

  it('新加：选中的字当文字，空光标插入文字 + 链接；接着打字不带链接', async () => {
    const { h, done } = await setup('一段话');
    expect(h.applyLink({ from: 1, to: 3 }, '一段', 'a.com')).toBe(true);
    expect(h.getMarkdown()).toBe('[一段](https://a.com)话\n');
    // 选中的字没改：只加链接；光标在链接后面，接着打的字不进链接
    const v0 = h.view();
    v0.dispatch(v0.state.tr.insertText('，'));
    expect(h.getMarkdown()).toBe('[一段](https://a.com)，话\n');
    const end = h.view().state.doc.content.size - 1;
    h.applyLink({ from: end, to: end }, '官网', 'https://b.com');
    expect(h.getMarkdown()).toBe('[一段](https://a.com)，话[官网](https://b.com)\n');
    const v = h.view();
    v.dispatch(v.state.tr.insertText('！'));
    expect(h.getMarkdown()).toBe('[一段](https://a.com)，话[官网](https://b.com)！\n');
    await done();
  });

  it('含括号、空格的网址，含方括号、星号的中文文字：往返稳定', async () => {
    const { h, done } = await setup('读 [书名](https://a.com)');
    const r = linkAt(h, '书名');
    h.applyLink(r, '《沙丘》[小说] *第一部*', 'https://zh.wikipedia.org/wiki/沙丘_(小说) 第一部');
    const md = h.getMarkdown();
    expect(md).toBe('读 [《沙丘》\\[小说\\] \\*第一部\\*](https://zh.wikipedia.org/wiki/沙丘_\\(小说\\)%20第一部)\n');
    await stable(md);
    // 读回来还是一条链接，文字和地址一样
    const again = await setup(md);
    const r2 = linkAt(again.h, '沙丘');
    expect(r2.href).toBe('https://zh.wikipedia.org/wiki/沙丘_(小说)%20第一部');
    expect(again.h.textOf(r2)).toBe('《沙丘》[小说] *第一部*');
    await again.done();
    await done();
  });

  it('选区跨段落：只加链接，不改文字', async () => {
    const { h, done } = await setup('第一段\n\n第二段');
    const size = h.view().state.doc.content.size;
    h.applyLink({ from: 1, to: size - 1 }, '随便', 'a.com');
    expect(h.getMarkdown()).toBe('[第一段](https://a.com)\n\n[第二段](https://a.com)\n');
    await done();
  });
});
