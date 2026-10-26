/**
 * 介绍页（mindough.rei8t.dev 根路径，Rei 2026-10-26）。一个静态单页，中英两种，按浏览器语言选，右上角能切。
 * 以后要换成更完整的介绍页：只换这个文件（或让 landing/index.ts 改从 R2 / 单独的 Mindough-web 仓库出页面），
 * 但「搬家脚本」那段（跳转到 app 域名、提醒导出本机数据）要留着，老链接和装到主屏幕的旧版靠它。
 */
import { APP_ORIGIN } from '../hosts';

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
  arrow: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  download: '<path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/>',
};

/** 页面上的文字。key 写在 HTML 的 data-t 上，脚本按语言换。 */
export const LANDING_TEXT = {
  zh: {
    title: '念头团 Mindough',
    name: '念头团',
    tagline: '做完一件，接上下一件。任务、打卡、资料和日记放在一处，离线能用，登录后多台设备同步。',
    open: '打开网页版',
    download: '下载安装包',
    f1t: '任务链',
    f1d: '给任务设好先后：前面的做完了，后面的自动变成可开始。整条线一眼看完。',
    f2t: '打卡、计时、计数、倒数日',
    f2d: '读书记时长，喝水记毫升，考试倒数天数，定期的事记连续次数。',
    f3t: '资料库',
    f3d: '影视、书、游戏、餐厅、菜谱……一条资料能给好几件任务用，在线查封面和信息。',
    f4t: '日记',
    f4d: '每天写几句，按日期翻看。',
    f5t: '离线能用，多端同步',
    f5d: '数据先存在本机。用 Google 登录后，电脑、手机和网页之间自动同步。',
    dl: 'macOS、Windows、Android 安装包在 GitHub Releases 下载。iPhone 和 iPad 先用网页版，可以添加到主屏幕。',
    movedT: '网页版搬到了新地址',
    movedD: '网页版现在在 app.mindough.rei8t.dev。这个浏览器在旧地址里还存着本机数据：登录过、同步完的，到新地址登录后会自动同步回来；没登录过的，先在旧地址导出备份，再到新地址的「设置 → 数据 → 导入」导进去。',
    pwaD: '装到主屏幕的旧版以后不再更新。到新地址打开后，请重新添加到主屏幕，再删掉旧的。',
    exportBtn: '在旧地址导出备份',
    goBtn: '已同步，去新地址',
    footer: '念头团 · Mindough',
  },
  en: {
    title: 'Mindough',
    name: 'Mindough',
    tagline: 'Finish one thing, and the next one is ready. Tasks, habits, collections and a journal in one place — works offline, syncs across devices when you sign in.',
    open: 'Open web app',
    download: 'Download',
    f1t: 'Task chains',
    f1d: 'Set what comes first. When a task is done, the ones after it become ready. See the whole chain at a glance.',
    f2t: 'Check-ins, timers, counters, countdowns',
    f2d: 'Track reading time, glasses of water, days until the exam, and streaks for recurring habits.',
    f3t: 'Collections',
    f3d: 'Movies, books, games, restaurants, recipes… one entry can serve many tasks, with covers and details looked up online.',
    f4t: 'Journal',
    f4d: 'Write a few lines a day and flip back by date.',
    f5t: 'Offline first, synced everywhere',
    f5d: 'Your data lives on your device first. Sign in with Google to sync between computer, phone and web.',
    dl: 'Installers for macOS, Windows and Android are on GitHub Releases. On iPhone and iPad, use the web app and add it to your Home Screen.',
    movedT: 'The web app has moved',
    movedD: 'The web app now lives at app.mindough.rei8t.dev. This browser still has local data at the old address. If you signed in and synced, just sign in at the new address and it comes back. If you never signed in, export a backup here first, then import it at the new address under Settings → Data → Import.',
    pwaD: 'The old Home Screen app will no longer be updated. Open the new address, add it to your Home Screen again, then remove the old one.',
    exportBtn: 'Export a backup here',
    goBtn: 'Synced — take me there',
    footer: 'Mindough',
  },
} as const;

export type LandingLang = keyof typeof LANDING_TEXT;
type Key = keyof (typeof LANDING_TEXT)['zh'];

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
  return `<!doctype html>
<html lang="${lang === 'zh' ? 'zh-CN' : 'en'}">
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
  .lang { display: inline-flex; border: 1px solid var(--line); border-radius: 999px; overflow: hidden; background: var(--card); }
  .lang button { border: 0; background: none; color: var(--muted); padding: 4px 12px; font: inherit; font-size: 13px; cursor: pointer; }
  .lang button[aria-pressed="true"] { background: var(--soft); color: var(--fg); }
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
  .btn:focus-visible, .lang button:focus-visible { outline: 3px solid var(--soft); outline-offset: 2px; }
  .cards { list-style: none; padding: 0; margin: 40px 0 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 20px; }
  .card .ic { display: inline-flex; width: 40px; height: 40px; align-items: center; justify-content: center; border-radius: 10px; background: var(--soft); color: var(--accent); }
  .card h3 { margin: 12px 0 4px; font-size: 17px; }
  .card p { margin: 0; color: var(--muted); font-size: 15px; }
  .dl { margin: 32px auto 0; max-width: 640px; text-align: center; color: var(--muted); font-size: 14px; }
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
    <div class="lang" role="group" aria-label="Language">
      <button type="button" data-lang="zh" aria-pressed="${lang === 'zh'}">中文</button><button type="button" data-lang="en" aria-pressed="${lang === 'en'}">English</button>
    </div>
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
      <h1><span data-t="name">${esc(t.name)}</span><small>${lang === 'zh' ? 'Mindough' : ''}</small></h1>
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

  // 语言：先看手动选过的，再看浏览器语言
  function pickLang() {
    var saved = store('mindough:landing-lang');
    if (saved === 'zh' || saved === 'en') return saved;
    var ls = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || 'en'];
    for (var i = 0; i < ls.length; i++) { var l = String(ls[i]).toLowerCase(); if (l.indexOf('zh') === 0) return 'zh'; if (l.indexOf('en') === 0) return 'en'; }
    return 'en';
  }
  function apply(lang) {
    var t = TEXT[lang];
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    document.querySelectorAll('[data-t]').forEach(function (el) { var k = el.getAttribute('data-t'); if (t[k]) el.textContent = t[k]; });
    var sub = document.querySelector('.hero h1 small'); if (sub) sub.textContent = lang === 'zh' ? 'Mindough' : '';
    document.querySelectorAll('.lang button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-lang') === lang)); });
  }
  apply(pickLang());
  document.querySelectorAll('.lang button').forEach(function (b) {
    b.addEventListener('click', function () { var l = b.getAttribute('data-lang'); store('mindough:landing-lang', l); apply(l); });
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
