// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FILE_KINDS } from '@mindough/core';
import { FileIcon } from './FileIcon';
import '../../lib/i18n';

describe('文件类型图标', () => {
  it('每种各画各的、颜色走 --file 令牌（类名），不写死颜色', () => {
    const svgs = FILE_KINDS.map((k) => renderToStaticMarkup(<FileIcon name="x" mime="" kind={k} />));
    expect(new Set(svgs).size).toBe(FILE_KINDS.length);
    for (const [i, svg] of svgs.entries()) {
      expect(svg).toContain(`file-${FILE_KINDS[i]}`);
      expect(svg).not.toMatch(/#[0-9a-f]{3,6}\b/i);
      expect(svg).toContain('aria-hidden="true"');
      expect(svg).toContain('role="img"');
    }
  });
  it('按名字认类型、写扩展名（最多 4 个字母）', () => {
    const pdf = renderToStaticMarkup(<FileIcon name="收据.pdf" mime="application/pdf" />);
    expect(pdf).toContain('file-pdf');
    expect(pdf).toContain('>PDF<');
    expect(renderToStaticMarkup(<FileIcon name="a.markdown" mime="" />)).toContain('>MARK<');
    expect(renderToStaticMarkup(<FileIcon name="Makefile" mime="" />)).not.toContain('fi-ext');
  });
});
