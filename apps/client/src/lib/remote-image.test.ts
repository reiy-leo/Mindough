// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { markdownHtml, renderMarkdown } from './markdown';
import { isRemoteImage, remoteImageText } from './remote-image';

describe('网络图片的判断（Rei 2026-10-17）', () => {
  it('http(s) 与 // 开头算网络图片；data: / blob: / 相对路径 / 自己的 /api/assets/ 不算', () => {
    expect(isRemoteImage('https://x.com/a.png')).toBe(true);
    expect(isRemoteImage(' HTTP://x.com/a.png')).toBe(true);
    expect(isRemoteImage('//cdn.x/a.png')).toBe(true);
    expect(isRemoteImage('https://mindough.rei8t.dev/other.png')).toBe(true);
    expect(isRemoteImage('https://evil.com/api/assets/a.png')).toBe(true);
    expect(isRemoteImage('https://mindough.rei8t.dev/api/assets/u/1.webp')).toBe(false);
    // 搬到 app 域名后（Rei 2026-10-26），新旧两个地址的 /api/assets/ 都算自己的图
    expect(isRemoteImage('https://app.mindough.rei8t.dev/api/assets/u/1.webp')).toBe(false);
    expect(isRemoteImage('https://app.mindough.rei8t.dev/x.png')).toBe(true);
    expect(isRemoteImage('data:image/png;base64,AAAA')).toBe(false);
    expect(isRemoteImage('blob:https://x/1')).toBe(false);
    expect(isRemoteImage('/api/assets/u/1.webp')).toBe(false);
    expect(isRemoteImage('images/a.png')).toBe(false);
  });
  it('显示文字：alt，没有就网址', () => {
    expect(remoteImageText('https://x/a.png', ' 海报 ')).toBe('海报');
    expect(remoteImageText('https://x/a.png', '')).toBe('https://x/a.png');
  });
});

describe('只读预览里的网络图片', () => {
  it('不出 <img>，显示成文字（转义）；自己的图照常', () => {
    const html = markdownHtml('![<b>海报</b>](https://x.com/a.png) ![](https://x.com/b.png) ![c](data:image/png;base64,AA)');
    expect(html).not.toContain('<img src="https://');
    expect(html).toContain('<span class="md-remote-image" title="https://x.com/a.png">&lt;b&gt;海报&lt;/b&gt;</span>');
    expect(html).toContain('>https://x.com/b.png</span>');
    expect(html).toContain('<img src="data:image/png;base64,AA" alt="c"');
  });
  it('消毒后 span 还在', () => {
    expect(renderMarkdown('![图](https://x.com/a.png)')).toContain('class="md-remote-image"');
  });
});
