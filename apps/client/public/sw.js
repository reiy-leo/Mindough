// Mindough 的 service worker：只用来发提醒通知（Android Chrome 只能经 service worker 发通知），不缓存任何东西。
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
// 点通知：回到已经开着的 Mindough（没有就新开一个），让它打开那件任务
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const taskId = e.notification.data && e.notification.data.taskId;
  e.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const c = all[0];
      if (c) {
        await c.focus();
        c.postMessage({ type: 'open-task', taskId });
      } else {
        await self.clients.openWindow('/#/myday');
      }
    })(),
  );
});
