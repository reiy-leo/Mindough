import { describe, expect, it } from 'vitest';
import { externalHref } from './external';

const ORIGIN = 'tauri://localhost';

describe('外链交给系统浏览器', () => {
  it('别的源的 http(s) 链接算外链', () => {
    expect(externalHref('https://www.imdb.com/title/tt0816692/', ORIGIN)).toBe('https://www.imdb.com/title/tt0816692/');
    expect(externalHref('http://example.com', 'http://tauri.localhost')).toBe('http://example.com/');
  });
  it('mailto / tel 也交给系统', () => {
    expect(externalHref('mailto:a@b.c', ORIGIN)).toBe('mailto:a@b.c');
    expect(externalHref('tel:+6512345678', ORIGIN)).toBe('tel:+6512345678');
  });
  it('站内路由、同源、javascript: 不拦', () => {
    expect(externalHref('#/library', ORIGIN)).toBeNull();
    expect(externalHref('/library', 'http://tauri.localhost')).toBeNull();
    expect(externalHref('http://tauri.localhost/x', 'http://tauri.localhost')).toBeNull();
    expect(externalHref('javascript:alert(1)', ORIGIN)).toBeNull();
    expect(externalHref('', ORIGIN)).toBeNull();
    expect(externalHref(null, ORIGIN)).toBeNull();
  });
});
