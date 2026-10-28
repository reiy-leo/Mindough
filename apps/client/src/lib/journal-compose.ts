/**
 * 「写一条」：从我的一天的小卡、⌘K「写日记」、提醒进日记页时，让输入框拿到焦点。
 * 页面还没挂上就先记一笔，挂上时取走；已经在日记页就发事件。
 */
let pending = false;
const EVENT = 'mindough:journal-compose';

export function requestJournalCompose(): void {
  pending = true;
  window.dispatchEvent(new Event(EVENT));
}

/** 有没有等着的「写一条」（取走就清掉）。 */
export function takeJournalCompose(): boolean {
  const was = pending;
  pending = false;
  return was;
}

export function onJournalCompose(fn: () => void): () => void {
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
}
