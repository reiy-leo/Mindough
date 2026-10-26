import { describe, expect, it } from 'vitest';
import { handle, type Env } from '../src/index';
import { APP_ORIGIN, LEGACY_ORIGIN } from '../src/hosts';
import { guessLang } from '../src/landing';
import { LANDING_TEXT, landingHtml } from '../src/landing/page';

// 两个域名（Rei 2026-10-26「那就把app搬到 app.mindough.rei8t.dev，mindough.rei8t.dev留给介绍页」）
const files: Record<string, string> = { 'index.html': '<html>app</html>', 'sw.js': '// app sw', 'assets/a.js': 'x', 'manifest.webmanifest': '{}' };
const WEB = { get: async (k: string) => (k in files ? { body: new Response(files[k]).body!, httpEtag: '"e"' } : null) };
const env: Env = { WEB, SESSION_SECRET: 'test-secret-0123456789', GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 's', ALLOWED_EMAILS: 'a@b.c' };
const get = (origin: string, path: string, headers: Record<string, string> = {}) => handle(new Request(origin + path, { headers }), env);

describe('旧域名 mindough.rei8t.dev', () => {
  it('根路径是介绍页（200 成功），按钮指向 app 域名', async () => {
    const res = await get(LEGACY_ORIGIN, '/', { 'accept-language': 'zh-CN,zh;q=0.9' });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(html).toContain('打开网页版');
    expect(html).toContain(`href="${APP_ORIGIN}/"`);
    expect(html).toContain('github.com/reiy-leo/Mindough/releases');
  });
  it('/index.html 也是介绍页；英文浏览器先出英文', async () => {
    const html = await (await get(LEGACY_ORIGIN, '/index.html', { 'accept-language': 'en-US,en' })).text();
    expect(html).toContain('Open web app');
    expect(html).toContain('<html lang="en">');
  });
  it('/api/health 照常（老客户端还连这里）', async () => {
    const res = await get(LEGACY_ORIGIN, '/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, name: 'mindough' });
  });
  it('/auth/login 照常 302 到 Google，回调地址用旧域名（Google 控制台已登记）', async () => {
    const res = await get(LEGACY_ORIGIN, '/auth/login');
    expect(res.status).toBe(302);
    expect(new URL(res.headers.get('location')!).searchParams.get('redirect_uri')).toBe(`${LEGACY_ORIGIN}/auth/callback`);
  });
  it('/sw.js 换成注销自己的版本', async () => {
    const res = await get(LEGACY_ORIGIN, '/sw.js');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('registration.unregister()');
  });
  it('/local/ 照旧出 app（用来导出本机数据），带跨源隔离头', async () => {
    const res = await get(LEGACY_ORIGIN, '/local/');
    expect(await res.text()).toBe('<html>app</html>');
    expect(res.headers.get('cross-origin-embedder-policy')).toBe('credentialless');
  });
  it('静态资源照旧', async () => {
    expect(await (await get(LEGACY_ORIGIN, '/assets/a.js')).text()).toBe('x');
  });
});

describe('app 域名 app.mindough.rei8t.dev', () => {
  it('根路径是 app，sw.js 是 app 的', async () => {
    expect(await (await get(APP_ORIGIN, '/')).text()).toBe('<html>app</html>');
    expect(await (await get(APP_ORIGIN, '/sw.js')).text()).toBe('// app sw');
  });
  it('登录回调地址按请求的域名生成', async () => {
    const res = await get(APP_ORIGIN, '/auth/login');
    expect(new URL(res.headers.get('location')!).searchParams.get('redirect_uri')).toBe(`${APP_ORIGIN}/auth/callback`);
  });
});

describe('介绍页内容', () => {
  it('中英两种文字 key 一样全', () => {
    expect(Object.keys(LANDING_TEXT.en).sort()).toEqual(Object.keys(LANDING_TEXT.zh).sort());
  });
  it('Accept-Language 猜语言：zh 开头是中文，其他是英文', () => {
    expect(guessLang('zh-TW')).toBe('zh');
    expect(guessLang('ja,en;q=0.5')).toBe('en');
    expect(guessLang(null)).toBe('en');
  });
  it('脚本里带着跳转逻辑和 app 域名', () => {
    const html = landingHtml('zh');
    expect(html).toContain(JSON.stringify(APP_ORIGIN));
    expect(html).toContain("location.replace(target)");
    expect(html).toContain('/local/#/settings/data');
  });
});
