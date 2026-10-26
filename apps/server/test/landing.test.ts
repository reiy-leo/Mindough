import { describe, expect, it } from 'vitest';
import { Window } from 'happy-dom';
import { handle, type Env } from '../src/index';
import { APP_ORIGIN, LEGACY_ORIGIN } from '../src/hosts';
import { guessLang } from '../src/landing';
import { HTML_LANG, LANDING_LANGS, LANDING_TEXT, LANG_NAMES, landingHtml, matchLang, type LandingLang } from '../src/landing/page';

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

/** 在 happy-dom 里跑介绍页的脚本：给定地址、浏览器语言和 localStorage，返回窗口。 */
function runPage(opts: { url?: string; languages?: string[]; saved?: string; serverLang?: LandingLang } = {}) {
  const w = new Window({ url: opts.url ?? `${LEGACY_ORIGIN}/` });
  Object.defineProperty(w.navigator, 'languages', { value: opts.languages ?? ['en-US'], configurable: true });
  if (opts.saved) w.localStorage.setItem('mindough:landing-lang', opts.saved);
  const html = landingHtml(opts.serverLang ?? 'zh');
  w.document.write(html.replace(/<script>[\s\S]*<\/script>/, ''));
  const script = /<script>([\s\S]*)<\/script>/.exec(html)![1]!;
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function('window', 'document', 'navigator', 'location', 'localStorage', 'history', 'matchMedia', 'URL', 'URLSearchParams', script)(
    w, w.document, w.navigator, w.location, w.localStorage, w.history, w.matchMedia.bind(w), w.URL, w.URLSearchParams,
  );
  const text = (k: string) => w.document.querySelector(`[data-t="${k}"]`)!.textContent;
  const select = w.document.getElementById('lang') as unknown as { value: string; dispatchEvent(e: unknown): void; options: { length: number } };
  const choose = (lang: string) => { select.value = lang; select.dispatchEvent(new w.Event('change')); };
  return { w, text, select, choose, htmlLang: () => w.document.documentElement.getAttribute('lang') };
}

describe('介绍页九种语言（Rei 2026-10-26 19:41「这个网站也要i18n」）', () => {
  it('九种语言都有，key 跟中文完全一样，没有空文案（sub 除外）', () => {
    expect([...LANDING_LANGS]).toEqual(['zh', 'en', 'es', 'pt-BR', 'ru', 'ja', 'de', 'fr', 'id']);
    const keys = Object.keys(LANDING_TEXT.zh).sort();
    for (const l of LANDING_LANGS) {
      expect(Object.keys(LANDING_TEXT[l]).sort(), l).toEqual(keys);
      for (const [k, v] of Object.entries(LANDING_TEXT[l])) if (k !== 'sub') expect(String(v).trim(), `${l}.${k}`).not.toBe('');
      expect(LANG_NAMES[l]).toBeTruthy();
      expect(HTML_LANG[l]).toBeTruthy();
    }
  });
  it('搬家提示里九种都写了新地址', () => {
    for (const l of LANDING_LANGS) expect(LANDING_TEXT[l].movedD, l).toContain('app.mindough.rei8t.dev');
  });
  it('matchLang：地区变体、旧代码都能对上', () => {
    expect(matchLang('zh-TW')).toBe('zh');
    expect(matchLang('zh-Hans-CN')).toBe('zh');
    expect(matchLang('pt')).toBe('pt-BR');
    expect(matchLang('pt-PT')).toBe('pt-BR');
    expect(matchLang('en_GB')).toBe('en');
    expect(matchLang('in')).toBe('id');
    expect(matchLang('JA-jp')).toBe('ja');
    expect(matchLang('ko')).toBeNull();
    expect(matchLang('')).toBeNull();
    expect(matchLang(null)).toBeNull();
  });
  it('Accept-Language 猜语言：按 q 值挑第一个支持的，?lang= 优先', () => {
    expect(guessLang('zh-TW')).toBe('zh');
    expect(guessLang('ja,en;q=0.5')).toBe('ja');
    expect(guessLang('ko-KR,ko;q=0.9,de;q=0.8,en;q=0.7')).toBe('de');
    expect(guessLang('en;q=0.3,fr;q=0.9')).toBe('fr');
    expect(guessLang('pt-PT')).toBe('pt-BR');
    expect(guessLang('ko')).toBe('en');
    expect(guessLang(null)).toBe('en');
    expect(guessLang('zh-CN', 'ru')).toBe('ru');
    expect(guessLang('zh-CN', 'xx')).toBe('zh');
  });
  it('服务端按语言出页面：<html lang>、文案、切换器选中', async () => {
    for (const [al, lang] of [['de-DE,de', 'de'], ['es-MX', 'es'], ['pt-BR', 'pt-BR'], ['ru', 'ru'], ['ja-JP', 'ja'], ['fr-CA', 'fr'], ['id-ID', 'id']] as const) {
      const html = await (await get(LEGACY_ORIGIN, '/', { 'accept-language': al })).text();
      expect(html, al).toContain(`<html lang="${HTML_LANG[lang]}">`);
      expect(html, al).toContain(LANDING_TEXT[lang].open);
      expect(html, al).toContain(`<option value="${lang}" lang="${HTML_LANG[lang]}" selected>`);
    }
    const viaQuery = await (await get(LEGACY_ORIGIN, '/?lang=ja', { 'accept-language': 'en' })).text();
    expect(viaQuery).toContain('<html lang="ja">');
  });
  it('切换器列出九种，用各自本名', () => {
    const html = landingHtml('en');
    for (const l of LANDING_LANGS) expect(html).toContain(`>${LANG_NAMES[l]}</option>`);
    expect(html).toContain('简体中文');
    expect(html).toContain('Bahasa Indonesia');
  });
});

describe('介绍页脚本：自动选语言和切换', () => {
  it('按 navigator.languages 选第一个支持的', () => {
    const p = runPage({ languages: ['ko-KR', 'de-AT', 'en'] });
    expect(p.htmlLang()).toBe('de');
    expect(p.text('open')).toBe(LANDING_TEXT.de.open);
    expect(p.select.value).toBe('de');
  });
  it('都不支持就用英文', () => {
    const p = runPage({ languages: ['ko-KR', 'th'] });
    expect(p.htmlLang()).toBe('en');
    expect(p.text('tagline')).toBe(LANDING_TEXT.en.tagline);
  });
  it('pt-PT 用巴西葡语，zh-TW 用简体中文', () => {
    expect(runPage({ languages: ['pt-PT'] }).htmlLang()).toBe('pt-BR');
    const zh = runPage({ languages: ['zh-TW'], serverLang: 'en' });
    expect(zh.htmlLang()).toBe('zh-CN');
    expect(zh.text('sub')).toBe('Mindough');
  });
  it('手动选过的（localStorage）优先于浏览器语言', () => {
    const p = runPage({ languages: ['en-US'], saved: 'ja' });
    expect(p.htmlLang()).toBe('ja');
    expect(p.text('f3t')).toBe('コレクション');
  });
  it('?lang= 优先于手动选过的', () => {
    const p = runPage({ url: `${LEGACY_ORIGIN}/?lang=fr`, languages: ['en-US'], saved: 'ja' });
    expect(p.htmlLang()).toBe('fr');
    expect(p.text('open')).toBe(LANDING_TEXT.fr.open);
  });
  it('切换：文案、<html lang>、标题都换，存进 localStorage', () => {
    const p = runPage({ languages: ['en-US'] });
    expect(p.select.options.length).toBe(9);
    p.choose('ru');
    expect(p.htmlLang()).toBe('ru');
    expect(p.text('open')).toBe(LANDING_TEXT.ru.open);
    expect(p.text('movedT')).toBe(LANDING_TEXT.ru.movedT);
    expect(p.w.document.title).toBe(LANDING_TEXT.ru.title);
    expect(p.text('sub')).toBe('');
    expect(p.w.localStorage.getItem('mindough:landing-lang')).toBe('ru');
    p.choose('zh');
    expect(p.htmlLang()).toBe('zh-CN');
    expect(p.text('sub')).toBe('Mindough');
    expect(p.w.document.querySelector('meta[name="description"]')!.getAttribute('content')).toBe(LANDING_TEXT.zh.tagline);
  });
  it('地址栏有 ?lang= 时切换会改掉它，刷新后还是新选的', () => {
    const p = runPage({ url: `${LEGACY_ORIGIN}/?lang=fr`, languages: ['en-US'] });
    p.choose('id');
    expect(new URL(p.w.location.href).searchParams.get('lang')).toBe('id');
    expect(p.htmlLang()).toBe('id');
  });
});

describe('介绍页内容', () => {
  it('脚本里带着跳转逻辑和 app 域名', () => {
    const html = landingHtml('zh');
    expect(html).toContain(JSON.stringify(APP_ORIGIN));
    expect(html).toContain("location.replace(target)");
    expect(html).toContain('/local/#/settings/data');
  });
});
