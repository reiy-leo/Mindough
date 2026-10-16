/**
 * 标签页锁（Rei 2026-10-16：「打开多个 tab 时，其他页面都只显示警告不显示内容」）。
 * Web Locks：先打开的标签页拿着锁、正常用；后打开的拿不到，只显示「已在另一个标签页打开」和「在这里用」。
 * 「在这里用」= steal：锁转到这一页，原来那页的锁被夺走（lost 结束），它停掉数据库、换成警告。
 * 没有 Web Locks 的环境（很老的浏览器、测试）当作总能拿到。
 */
const LOCK = 'mindough:local-db';

export interface TabLock {
  /** 锁被别的标签页抢走时结束。 */
  lost: Promise<void>;
}

export function acquireTabLock(steal = false): Promise<TabLock | null> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (!locks) return Promise.resolve({ lost: new Promise<void>(() => {}) });
  return new Promise((resolve) => {
    let markLost!: () => void;
    const lost = new Promise<void>((r) => (markLost = r));
    const held = locks.request(LOCK, steal ? { steal: true } : { ifAvailable: true }, (lock) => {
      if (!lock) {
        resolve(null);
        return undefined;
      }
      resolve({ lost });
      // 一直拿着，直到页面关掉或被抢走
      return new Promise<void>(() => {});
    });
    // 被 steal 时 request 的 promise 以 AbortError 结束
    held.then(markLost, markLost);
  });
}
