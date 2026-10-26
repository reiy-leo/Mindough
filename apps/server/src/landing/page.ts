/**
 * 介绍页（mindough.rei8t.dev 根路径，Rei 2026-10-26）。一个静态单页，九种语言（文字在 text.ts）：
 * 先看 ?lang=，再看手动选过的（localStorage），再按 navigator.languages 选；右上角能切。
 * 以后要换成更完整的介绍页：只换这个文件（或让 landing/index.ts 改从 R2 / 单独的 Mindough-web 仓库出页面），
 * 但「搬家脚本」那段（跳转到 app 域名、提醒导出本机数据）要留着，老链接和装到主屏幕的旧版靠它。
 */
import { APP_ORIGIN } from '../hosts';
import { HTML_LANG, LANDING_LANGS, LANDING_TEXT, LANG_NAMES, matchLang, type LandingKey, type LandingLang } from './text';

export const RELEASES_URL = 'https://github.com/reiy-leo/Mindough/releases';

// Lucide 图标（lucide.dev，ISC 许可），内联成 SVG
const icon = (paths: string) =>
  `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const ICONS = {
  workflow: '<rect width="8" height="8" x="3" y="3" rx="2"/><path d="M7 11v4a2 2 0 0 0 2 2h4"/><rect width="8" height="8" x="13" y="13" rx="2"/>',
  timer: '<line x1="10" x2="14" y1="2" y2="2"/><line x1="12" x2="15" y1="14" y2="11"/><circle cx="12" cy="14" r="8"/>',
  library: '<path d="m16 6 4 14"/><path d="M12 6v14"/><path d="M8 8v12"/><path d="M4 4v16"/>',
  book: '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
  sync: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  languages: '<path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/>',
  arrow: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  download: '<path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/>',
};

export { LANDING_TEXT, LANDING_LANGS, LANG_NAMES, HTML_LANG, matchLang, type LandingLang } from './text';
type Key = LandingKey;

const FEATURES: [keyof typeof ICONS, Key, Key][] = [
  ['workflow', 'f1t', 'f1d'],
  ['timer', 'f2t', 'f2d'],
  ['library', 'f3t', 'f3d'],
  ['book', 'f4t', 'f4d'],
  ['sync', 'f5t', 'f5d'],
];

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 介绍页 HTML。lang 是服务端按 Accept-Language 先猜的语言，页面里的脚本再按 navigator.languages 校正。 */
export function landingHtml(lang: LandingLang = 'zh'): string {
  const t = LANDING_TEXT[lang];
  const tx = (k: Key) => `data-t="${k}">${esc(t[k])}`;
  const features = FEATURES.map(
    ([ic, title, desc]) => `<li class="card"><span class="ic">${icon(ICONS[ic])}</span><h3 ${tx(title)}</h3><p ${tx(desc)}</p></li>`,
  ).join('');
  const langOptions = LANDING_LANGS.map(
    (l) => `<option value="${l}" lang="${HTML_LANG[l]}"${l === lang ? ' selected' : ''}>${esc(LANG_NAMES[l])}</option>`,
  ).join('');
  return `<!doctype html>
<html lang="${HTML_LANG[lang]}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="color-scheme" content="light dark" />
<meta name="theme-color" content="#2f6fed" />
<title data-t="title">${esc(t.title)}</title>
<meta name="description" content="${esc(t.tagline)}" />
<link rel="icon" type="image/png" href="/favicon.png" />
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
<style>
  :root { --bg:#f7f8fb; --fg:#151a24; --muted:#5b6475; --card:#fff; --line:#e3e7ef; --accent:#2f6fed; --accent-fg:#fff; --soft:#e8effe; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0f1218; --fg:#e8ebf2; --muted:#9aa3b5; --card:#171b24; --line:#262c38; --accent:#5b8ff5; --accent-fg:#0b1020; --soft:#1b2640; } }
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body { background: var(--bg); color: var(--fg); font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif; -webkit-font-smoothing: antialiased; }
  a { color: inherit; }
  .wrap { max-width: 960px; margin: 0 auto; padding: 24px 24px 48px; }
  header.top { display: flex; justify-content: flex-end; }
  .lang { position: relative; display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--line); border-radius: 999px; background: var(--card); color: var(--muted); padding: 0 10px 0 12px; }
  .lang svg { width: 16px; height: 16px; flex: none; pointer-events: none; }
  .lang select { appearance: none; -webkit-appearance: none; border: 0; background: none; color: var(--fg); font: inherit; font-size: 13px; padding: 6px 16px 6px 0; cursor: pointer; }
  .lang::after { content: ""; position: absolute; right: 12px; top: 50%; width: 6px; height: 6px; margin-top: -5px; border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor; transform: rotate(45deg); pointer-events: none; }
  .lang select option { color: #151a24; background: #fff; }
  :lang(ja) body, body:lang(ja) { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic UI", Meiryo, "Noto Sans CJK JP", sans-serif; }
  .hero { text-align: center; padding: 48px 0 32px; }
  .hero img { width: 112px; height: 112px; display: block; margin: 0 auto; }
  .hero h1 { font-size: 40px; line-height: 1.2; margin: 20px 0 8px; letter-spacing: .01em; }
  .hero h1 small { display: block; font-size: 16px; font-weight: 500; color: var(--muted); margin-top: 6px; letter-spacing: .04em; }
  .hero p { max-width: 560px; margin: 0 auto; color: var(--muted); font-size: 18px; }
  .actions { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; margin-top: 28px; }
  .btn { display: inline-flex; align-items: center; gap: 8px; padding: 12px 22px; border-radius: 12px; font-weight: 600; text-decoration: none; border: 1px solid transparent; cursor: pointer; font-size: 16px; font-family: inherit; }
  .btn svg { width: 18px; height: 18px; }
  .btn.primary { background: var(--accent); color: var(--accent-fg); }
  .btn.ghost { background: var(--card); border-color: var(--line); color: var(--fg); }
  .btn:focus-visible, .lang:focus-within { outline: 3px solid var(--soft); outline-offset: 2px; }
  .cards { list-style: none; padding: 0; margin: 40px 0 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 20px; }
  .card .ic { display: inline-flex; width: 40px; height: 40px; align-items: center; justify-content: center; border-radius: 10px; background: var(--soft); color: var(--accent); }
  .card h3 { margin: 12px 0 4px; font-size: 17px; }
  .card p { margin: 0; color: var(--muted); font-size: 15px; }
  .dl { margin: 32px auto 0; max-width: 640px; text-align: center; color: var(--muted); font-size: 14px; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  footer { text-align: center; color: var(--muted); font-size: 13px; margin-top: 40px; }
  .moved { display: none; margin: 8px auto 0; max-width: 640px; background: var(--card); border: 1px solid var(--accent); border-radius: 16px; padding: 20px; }
  .moved.show { display: block; }
  .moved h2 { margin: 0 0 6px; font-size: 18px; }
  .moved p { margin: 0 0 8px; color: var(--muted); font-size: 15px; }
  .moved .actions { justify-content: flex-start; margin-top: 16px; }
  @media (max-width: 480px) { .wrap { padding: 16px 16px 40px; } .hero { padding: 28px 0 20px; } .hero h1 { font-size: 32px; } .hero p { font-size: 16px; } .btn { flex: 1 1 auto; justify-content: center; } }
</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <label class="lang">${icon(ICONS.languages)}<span class="sr" data-t="langLabel">${esc(t.langLabel)}</span>
      <select id="lang">${langOptions}</select>
    </label>
  </header>
  <section class="moved" id="moved" role="alert">
    <h2 data-t="movedT">${esc(t.movedT)}</h2>
    <p data-t="movedD">${esc(t.movedD)}</p>
    <p id="pwa" hidden data-t="pwaD">${esc(t.pwaD)}</p>
    <div class="actions">
      <a class="btn ghost" id="export" href="/local/#/settings/data">${icon(ICONS.download)}<span data-t="exportBtn">${esc(t.exportBtn)}</span></a>
      <a class="btn primary" id="go" href="${APP_ORIGIN}/"><span data-t="goBtn">${esc(t.goBtn)}</span>${icon(ICONS.arrow)}</a>
    </div>
  </section>
  <main>
    <section class="hero">
      <img src="/icons/icon-512.png" alt="" width="112" height="112" />
      <h1><span data-t="name">${esc(t.name)}</span><small data-t="sub">${esc(t.sub)}</small></h1>
      <p data-t="tagline">${esc(t.tagline)}</p>
      <div class="actions">
        <a class="btn primary" id="open" href="${APP_ORIGIN}/"><span data-t="open">${esc(t.open)}</span>${icon(ICONS.arrow)}</a>
        <a class="btn ghost" href="${RELEASES_URL}" rel="noopener">${icon(ICONS.download)}<span data-t="download">${esc(t.download)}</span></a>
      </div>
    </section>
    <ul class="cards">${features}</ul>
    <p class="dl" data-t="dl">${esc(t.dl)}</p>
  </main>
  <footer data-t="footer">${esc(t.footer)}</footer>
</div>
<script>
(function () {
  var APP = ${JSON.stringify(APP_ORIGIN)};
  var TEXT = ${JSON.stringify(LANDING_TEXT)};
  var ACK = 'mindough:moved-ack';
  var PWA_SEEN = 'mindough:pwa-moved-seen';
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }

  // 语言：?lang= 优先，再看手动选过的，再按浏览器语言（navigator.languages），都对不上用英文
  var HTML_LANG = ${JSON.stringify(HTML_LANG)};
  var LANG_KEY = 'mindough:landing-lang';
  var matchLang = ${matchLang.toString()};
  function pickLang() {
    var q = null;
    try { q = new URLSearchParams(location.search).get('lang'); } catch (e) {}
    var fromQuery = q && matchLang(q); if (fromQuery) return fromQuery;
    var saved = matchLang(store(LANG_KEY)); if (saved) return saved;
    var ls = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || 'en'];
    for (var i = 0; i < ls.length; i++) { var m = matchLang(ls[i]); if (m) return m; }
    return 'en';
  }
  function apply(lang) {
    var t = TEXT[lang];
    document.documentElement.lang = HTML_LANG[lang];
    document.querySelectorAll('[data-t]').forEach(function (el) { var k = el.getAttribute('data-t'); if (k in t) el.textContent = t[k]; });
    var meta = document.querySelector('meta[name="description"]'); if (meta) meta.setAttribute('content', t.tagline);
    var sel = document.getElementById('lang'); if (sel) sel.value = lang;
  }
  apply(pickLang());
  document.getElementById('lang').addEventListener('change', function (e) {
    var l = matchLang(e.target.value) || 'en';
    store(LANG_KEY, l);
    // 地址栏里的 ?lang= 会盖过手动选的，换成新选的
    try { var u = new URL(location.href); if (u.searchParams.has('lang')) { u.searchParams.set('lang', l); history.replaceState(null, '', u.toString()); } } catch (err) {}
    apply(l);
  });

  // ── 搬家：旧链接（#/…、?task=…）和装到主屏幕的旧版，跳到 app 域名同一路径 ──
  var target = APP + '/' + location.search + location.hash;
  var standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  var wantsApp = /^#\\//.test(location.hash) || /[?&](task|skin|login_error|view)=/.test(location.search) || standalone;
  document.getElementById('go').href = target;

  // 这个浏览器在旧地址里有没有本机数据（OPFS 里 app 的 SQLite 目录，或更早的 localStorage 数据）
  function hasLocalData() {
    var ls = false;
    try { for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i) || ''; if (k.indexOf('mindough') === 0 && k.indexOf('mindough:landing') !== 0 && k !== ACK && k !== PWA_SEEN) { ls = true; break; } } } catch (e) {}
    if (!navigator.storage || !navigator.storage.getDirectory) return Promise.resolve(ls);
    return navigator.storage.getDirectory().then(function (root) {
      var it = root.keys ? root.keys() : null;
      if (!it) return ls;
      function next() { return it.next().then(function (r) { if (r.done) return ls; if (String(r.value).indexOf('mindough') >= 0 || /\\.db$/.test(String(r.value))) return true; return next(); }); }
      return next();
    }).catch(function () { return ls; });
  }

  function showMoved() {
    document.getElementById('moved').classList.add('show');
    if (standalone) document.getElementById('pwa').hidden = false;
    document.getElementById('moved').scrollIntoView({ block: 'start' });
  }
  document.getElementById('go').addEventListener('click', function () { store(ACK, '1'); if (standalone) store(PWA_SEEN, '1'); });

  hasLocalData().then(function (local) {
    var needNotice = (local && store(ACK) !== '1') || (standalone && store(PWA_SEEN) !== '1');
    if (needNotice) {
      showMoved();
      // 「打开网页版」先看到提示：第一次点只显示提示，第二次照常走
      document.getElementById('open').addEventListener('click', function (e) {
        if (!document.getElementById('moved').dataset.seen) { e.preventDefault(); document.getElementById('moved').dataset.seen = '1'; showMoved(); }
      });
      return;
    }
    if (wantsApp) location.replace(target);
  });
})();
</script>
</body>
</html>`;
}
