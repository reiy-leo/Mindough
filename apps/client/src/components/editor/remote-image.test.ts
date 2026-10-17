// @vitest-environment happy-dom
/**
 * 编辑器里的网络图片（Rei 2026-10-17「编辑器不渲染网络图片」）：不出 <img>、显示 alt 或网址；markdown 原文照旧写回。
 */
import { describe, expect, it } from 'vitest';
import { createMdEditor, roundTrip } from './milkdown';

const mount = async (md: string) => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const h = await createMdEditor({ root, value: md, placeholder: '', label: 'x', onChange: () => {} });
  const html = { imgs: [...root.querySelectorAll('img:not(.ProseMirror-separator)')].map((i) => i.getAttribute('src')), remote: [...root.querySelectorAll('.md-remote-image')].map((s) => [s.textContent, s.getAttribute('title')]) };
  await h.destroy();
  root.remove();
  return html;
};

describe('编辑器里的网络图片', () => {
  it('https / http / // 的图片不出 <img>，显示 alt，没 alt 显示网址', async () => {
    const r = await mount('看图 ![沙丘海报](https://x.com/a.png) 和 ![](http://y.cn/b.jpg)\n\n![](//cdn.z/c.gif)');
    expect(r.imgs).toEqual([]);
    expect(r.remote).toEqual([
      ['沙丘海报', 'https://x.com/a.png'],
      ['http://y.cn/b.jpg', 'http://y.cn/b.jpg'],
      ['//cdn.z/c.gif', '//cdn.z/c.gif'],
    ]);
  });

  it('自己的图（data:、Mindough 的 /api/assets/）照常显示', async () => {
    const r = await mount('![a](data:image/png;base64,AAAA) ![b](https://mindough.rei8t.dev/api/assets/u/1.webp)');
    expect(r.imgs).toEqual(['data:image/png;base64,AAAA', 'https://mindough.rei8t.dev/api/assets/u/1.webp']);
    expect(r.remote).toEqual([]);
  });

  it('markdown 原文不变：读进来再写出去一样', async () => {
    for (const md of ['看图 ![沙丘海报](https://x.com/a.png "标题") 完', '![](https://x.com/a.png)']) expect(await roundTrip(md)).toBe(`${md}\n`);
  });

  it('setMarkdown 换进来的网络图片也不加载', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const h = await createMdEditor({ root, value: '', placeholder: '', label: 'x', onChange: () => {} });
    h.setMarkdown('![图](https://x.com/a.png)');
    expect(root.querySelectorAll('img:not(.ProseMirror-separator)').length).toBe(0);
    expect(root.querySelector('.md-remote-image')?.textContent).toBe('图');
    expect(h.getMarkdown()).toBe('![图](https://x.com/a.png)\n');
    await h.destroy();
    root.remove();
  });
});
