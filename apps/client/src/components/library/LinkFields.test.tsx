// 回归：填了 IMDb / 豆瓣编号，编辑资料里输入框旁有「打开」，资料卡 / 资料页的小标签是新标签页打开的链接。
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BUILTIN_TASK_TYPES, BUILTIN_TYPE_IDS, linkChips } from '@mindough/core';
import { ExtLink, LinkChips, SiteIdInput } from './LinkFields';

const movie = BUILTIN_TASK_TYPES.find((t) => t.id === BUILTIN_TYPE_IDS.movie)!;
const def = (key: string) => movie.fields.find((f) => f.key === key)!;
const links = (html: string) => [...html.matchAll(/<a [^>]*href="([^"]+)"[^>]*>/g)].map((m) => ({ href: m[1], tag: m[0] }));

describe('站点编号显示成链接', () => {
  it('编辑资料：IMDb 填了编号 → 输入框旁「打开」+ 下面的预览链接，都开新标签页', () => {
    const html = renderToStaticMarkup(<SiteIdInput def={def('imdb')} value="tt0816692" onChange={() => {}} />);
    const as = links(html);
    expect(as.map((a) => a.href)).toEqual(['https://www.imdb.com/title/tt0816692/', 'https://www.imdb.com/title/tt0816692/']);
    for (const a of as) expect(a.tag).toContain('target="_blank"');
    expect(html).toContain('aria-label="在 IMDb 打开"');
    expect(html).toContain('input-wrap');
  });

  it('编辑资料：豆瓣存的是整条链接也认；没填或认不出时没有「打开」，但输入框结构不变（不丢焦点）', () => {
    expect(links(renderToStaticMarkup(<SiteIdInput def={def('douban')} value="https://m.douban.com/movie/subject/1889243/" onChange={() => {}} />)).map((a) => a.href)).toContain(
      'https://movie.douban.com/subject/1889243/',
    );
    for (const v of [null, 'tt12']) {
      const html = renderToStaticMarkup(<SiteIdInput def={def('imdb')} value={v} onChange={() => {}} />);
      expect(links(html)).toEqual([]);
      expect(html).toContain('input-wrap');
    }
  });

  it('资料卡 / 资料页：小标签就是链接，IMDb 在前豆瓣在后', () => {
    const chips = linkChips(movie.fields, { imdb: 'tt0816692', douban: '1889243' });
    const html = renderToStaticMarkup(<LinkChips links={chips} />);
    expect(links(html).map((a) => a.href)).toEqual(['https://www.imdb.com/title/tt0816692/', 'https://movie.douban.com/subject/1889243/']);
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('点链接不往外传（外层卡片 / 弹层的点击不触发）', () => {
    const el = ExtLink({ href: 'https://www.imdb.com/title/tt0816692/', children: 'IMDb' }) as unknown as { props: Record<string, (e: unknown) => void> };
    for (const h of ['onClick', 'onPointerDown', 'onMouseDown', 'onTouchStart']) {
      let stopped = false;
      el.props[h]!({ stopPropagation: () => (stopped = true) });
      expect(stopped, h).toBe(true);
    }
  });
});
