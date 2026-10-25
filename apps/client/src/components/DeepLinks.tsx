import { useEffect } from 'react';
import { canWriteJournal, isArchivedType, isDateKey, isFinished, shouldJoinMyDay, toDateKey, type Store } from '@mindough/core';
import { drainDeepLinks, enqueueDeepLink, onDeepLink, parseHashLink, type DeepLinkAction } from '../lib/deeplink';
import { navigate } from '../lib/router';
import { useUi } from '../lib/ui';
import { titleOf } from '../lib/view';
import { useStore } from '../store/StoreProvider';
import { isTauri } from '../store/sqlite-tauri';
import { tr } from '../lib/i18n';

type Ui = ReturnType<typeof useUi>;

/** 原生端：把主窗口拉到前面（从别的 app 点链接进来时）。 */
async function focusMainWindow() {
  if (!isTauri()) return;
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const w = getCurrentWindow();
    await w.unminimize();
    await w.show();
    await w.setFocus();
  } catch {
    /* 拉不到前面也不要紧 */
  }
}

const shortTitle = (s: string) => (s.length > 24 ? `${s.slice(0, 24)}…` : s);

/** 执行一个深链接。做事的（new / checkin）不确认，直接做，提示里可以撤销。 */
export function runDeepLink(store: Store, ui: Ui, a: DeepLinkAction): void {
  const today = toDateKey(store.now());
  switch (a.kind) {
    case 'invalid':
      ui.toast({ tone: 'error', message: tr('这个链接打不开：{url}', { url: a.url }) });
      return;
    case 'view':
      navigate(a.route);
      return;
    case 'journal': {
      // 今天 = 按「一天从几点开始」算的那天；不是真日期 → 打开今天并提示；将来的日子 → 打开那天（页面上写不了）并提示
      if (a.date === 'today') return navigate({ page: 'journal', date: store.journalToday() });
      if (!isDateKey(a.date)) {
        navigate({ page: 'journal' });
        return ui.toast({ tone: 'error', message: tr('没有这一天：{date}', { date: a.date }) });
      }
      navigate({ page: 'journal', date: a.date });
      if (!canWriteJournal(a.date, store.journalToday())) ui.toast({ message: tr('这天还没到，还不能写') });
      return;
    }
    case 'task': {
      const t = store.get('task', a.id);
      if (!t) return ui.toast({ tone: 'error', message: tr('找不到这件任务') });
      ui.openEditor(t.id);
      return;
    }
    case 'new': {
      // 归档的类型不能再用来新建（退回普通）
      const linkType = a.typeId ? store.get('task_type', a.typeId) : undefined;
      const typeId = linkType && !isArchivedType(linkType) ? linkType.id : undefined;
      const groupId = a.groupId && store.get('group', a.groupId) ? a.groupId : undefined;
      const defaults = { ...(typeId ? { type_id: typeId } : {}), ...(groupId ? { group_id: groupId } : {}), ...(a.date ? { scheduled_date: a.date } : {}) };
      // 没写内容：打开新建面板，参数预填好
      if (!a.text) return ui.openQuickCreate(defaults, { myDay: a.myDay });
      const t = store.createTask({ ...defaults, body_md: a.text });
      if (shouldJoinMyDay({ fromMyDay: a.myDay, recurring: false, date: a.date, today })) store.addToMyDay(t.id);
      ui.toast(
        {
          tone: 'success',
          message: tr('已新建「{title}」', { title: shortTitle(titleOf(store, t)) }),
          actions: [
            { label: tr('打开'), onPress: () => ui.openEditor(t.id) },
            { label: tr('撤销'), onPress: () => store.deleteTask(t.id) },
          ],
        },
        6000,
      );
      return;
    }
    case 'checkin': {
      const t = store.get('task', a.id);
      if (!t) return ui.toast({ tone: 'error', message: tr('找不到这件任务') });
      const title = shortTitle(titleOf(store, t));
      // 计时、倒数日没法「打一下卡」：打开任务让人自己点
      if (t.completion_mode !== 'once' && t.completion_mode !== 'count') {
        ui.openEditor(t.id);
        return;
      }
      if (isFinished(t.status)) return ui.toast({ message: tr('「{title}」已经结束了', { title }) });
      const before = store.progress(t.id, today);
      if (t.completion_mode === 'once' && before?.met) return ui.toast({ message: tr('「{title}」今天已经打过卡了', { title }) });
      const prevStatus = t.status;
      const seen = new Set(store.checkInsOf(t.id).map((c) => c.id));
      const r = store.checkIn(t.id, 'add', t.completion_mode === 'once' ? 1 : a.amount, today);
      const added = store.checkInsOf(t.id).find((c) => !seen.has(c.id));
      const undo = () => {
        if (added) store.remove('check_in', added.id);
        if (store.get('task', t.id)?.status !== prevStatus) store.setStatus(t.id, prevStatus);
      };
      const p = r.progress;
      const message =
        t.completion_mode === 'count'
          ? tr('「{title}」+{amount}，{value}/{target}{unit}', { title, amount: a.amount, value: p.value, target: p.target ?? '', unit: t.unit ?? '' })
          : r.completed
            ? tr('已完成「{title}」', { title })
            : tr('「{title}」打卡了', { title });
      ui.toast({ tone: 'success', message, actions: [{ label: tr('撤销'), onPress: undo }] }, 6000);
      return;
    }
  }
}

/** 挂在 App 里：做排队的深链接（原生 mindough://），也接 web 的 #/task/…、#/new?…。 */
export function DeepLinks() {
  const store = useStore();
  const ui = useUi();
  useEffect(() => {
    const run = () => {
      const list = drainDeepLinks();
      if (!list.length) return;
      void focusMainWindow();
      for (const a of list) runDeepLink(store, ui, a);
    };
    const fromHash = () => {
      const a = parseHashLink(location.hash, store.now());
      if (!a) return;
      // 换回普通页面（刷新不会再做一遍）；打开任务时底下垫着「我的一天」
      history.replaceState(null, '', `${location.pathname}${location.search}#/myday`);
      window.dispatchEvent(new HashChangeEvent('hashchange'));
      enqueueDeepLink(a);
    };
    const off = onDeepLink(run);
    window.addEventListener('hashchange', fromHash);
    fromHash();
    run();
    return () => {
      off();
      window.removeEventListener('hashchange', fromHash);
    };
  }, [store, ui]);
  return null;
}
