// Mindough 的 service worker：发提醒通知（Android Chrome 只能经 service worker 发通知），并让「安装为 app」后断网也能打开。
// 缓存只管外壳：页面（index.html）先走网络、断网用上次的；/assets/ 下带哈希的文件先用缓存。/api、/auth 和别的一律不碰。
const SHELL = 'mindough-shell-v2';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) =>
  e.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (k.startsWith('mindough-shell-') && k !== SHELL) await caches.delete(k);
      await self.clients.claim();
    })(),
  ),
);
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) return;
  if (req.mode === 'navigate') {
    e.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          if (res.ok && res.type === 'basic' && !res.redirected) (await caches.open(SHELL)).put('/', res.clone());
          return res;
        } catch {
          return (await caches.match('/')) || Response.error();
        }
      })(),
    );
    return;
  }
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/') || url.pathname === '/favicon.png' || url.pathname === '/manifest.webmanifest') {
    e.respondWith(
      (async () => {
        const hit = await caches.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok && res.type === 'basic') (await caches.open(SHELL)).put(req, res.clone());
        return res;
      })(),
    );
  }
});
// 点通知：回到已经开着的 Mindough（没有就新开一个），让它打开那件任务（日记提醒打开日记）
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const data = e.notification.data || {};
  const taskId = data.taskId;
  // 日记提醒（data.journal）：打开日记今天那篇
  e.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const c = all[0];
      if (c) {
        await c.focus();
        c.postMessage(data.journal ? { type: 'open-journal' } : { type: 'open-task', taskId });
      } else {
        await self.clients.openWindow(data.journal ? '/#/journal' : '/#/myday');
      }
    })(),
  );
});
