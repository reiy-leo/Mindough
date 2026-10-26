/**
 * 介绍页域名（mindough.rei8t.dev）上的页面：根路径出介绍页（page.ts），/sw.js 换成一个只负责「注销自己、清缓存」的
 * service worker，让以前装过的 PWA 不再拿缓存里的旧 app 外壳顶替介绍页。其他路径不归这里管（见 index.ts）。
 */
import { landingHtml } from './page';
import { matchLang, type LandingLang } from './text';

/**
 * 服务端先猜语言：?lang= 优先，再按 Accept-Language（按 q 值从高到低）对九种语言，都对不上用英文。
 * 页面里的脚本还会按 ?lang=、手动选过的、navigator.languages 再定一次。
 */
export function guessLang(acceptLanguage: string | null, queryLang?: string | null): LandingLang {
  const q = queryLang ? matchLang(queryLang) : null;
  if (q) return q;
  const tags = (acceptLanguage ?? '')
    .split(',')
    .map((part, i) => {
      const [tag, ...params] = part.trim().split(';');
      const qp = params.find((p) => p.trim().startsWith('q='));
      const weight = qp ? Number(qp.trim().slice(2)) : 1;
      return { tag: (tag ?? '').trim(), weight: Number.isFinite(weight) ? weight : 0, i };
    })
    .filter((x) => x.tag && x.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.i - b.i);
  for (const { tag } of tags) {
    const m = matchLang(tag);
    if (m) return m;
  }
  return 'en';
}

export function serveLanding(req: Request): Response {
  const html = landingHtml(guessLang(req.headers.get('accept-language'), new URL(req.url).searchParams.get('lang')));
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
