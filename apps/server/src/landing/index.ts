/**
 * 介绍页域名（mindough.rei8t.dev）上的页面：根路径出介绍页（page.ts），/sw.js 换成一个只负责「注销自己、清缓存」的
 * service worker，让以前装过的 PWA 不再拿缓存里的旧 app 外壳顶替介绍页。其他路径不归这里管（见 index.ts）。
 */
import { landingHtml, type LandingLang } from './page';

/** 服务端先按 Accept-Language 猜语言（页面里的脚本还会按 navigator.languages 再定一次）。 */
export function guessLang(acceptLanguage: string | null): LandingLang {
  for (const part of (acceptLanguage ?? '').split(',')) {
    const l = part.trim().toLowerCase();
    if (l.startsWith('zh')) return 'zh';
    if (l.startsWith('en')) return 'en';
  }
  return 'en';
}

export function serveLanding(req: Request): Response {
  const html = landingHtml(guessLang(req.headers.get('accept-language')));
  return new Response(req.method === 'HEAD' ? null : html, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache', vary: 'accept-language', 'x-content-type-options': 'nosniff' },
  });
}

/** 旧域名的 /sw.js：装上就清掉 mindough 的缓存并注销自己；没有 fetch 处理，页面都走网络。 */
export const LEGACY_SW = `// Mindough 搬到了 app.mindough.rei8t.dev：旧域名不再需要 service worker，装上后清缓存、注销自己。
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) =>
  e.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (k.startsWith('mindough-')) await caches.delete(k);
      await self.registration.unregister();
    })(),
  ),
);
`;

export function serveLegacySw(): Response {
  return new Response(LEGACY_SW, { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-cache' } });
}
