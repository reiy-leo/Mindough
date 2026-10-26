import { useEffect, useState } from 'react';

/**
 * 设置的五个分区（Rei 2026-10-26「设置窗口侧边栏：账户、外观」，补充「数据、提醒、任务」）：
 * #/settings/account|appearance|data|reminders|tasks；不带分区的 #/settings 照旧能用。
 */
export const SETTINGS_SECTIONS = ['account', 'appearance', 'data', 'reminders', 'tasks', 'journal', 'about'] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];
export const isSettingsSection = (v: unknown): v is SettingsSection => typeof v === 'string' && (SETTINGS_SECTIONS as readonly string[]).includes(v);

export type Route =
  | { page: 'myday' }
  | { page: 'backlog' }
  | { page: 'agenda' }
  | { page: 'groups' }
  | { page: 'group'; id: string }
  | { page: 'people' }
  | { page: 'person'; id: string }
  /** 资料库：typeId 省略时显示第一个库。人物库沿用 #/people。 */
  | { page: 'library'; typeId?: string }
  | { page: 'libitem'; typeId: string; id: string }
  | { page: 'doable' }
  | { page: 'checkin' }
  /** 倒数日（Rei 2026-10-26 从打卡页拆出来，单独一页）。 */
  | { page: 'countdown' }
  /** 日记：date 省略 = 今天（按「一天从几点开始」算）。 */
  | { page: 'journal'; date?: string }
  /** 设置：section 省略时宽屏显示上次看的那项，窄屏先列出五项。 */
  | { page: 'settings'; section?: SettingsSection }
  /** 类型（统一的分类，Rei 2026-10-26）：#/types，#/types/<id> 看挂了它的任务和项目。 */
  | { page: 'types'; id?: string }
  | { page: 'more' };

/** hash 里 ? 之前的路径部分（?task= 等参数不算路由）。 */
function hashPath(hash: string): string {
  const h = hash.replace(/^#/, '');
  const qi = h.indexOf('?');
  return qi >= 0 ? h.slice(0, qi) : h;
}

export function parseHash(hash: string): Route {
  const [, rawA, b, c] = hashPath(hash).split('/');
  // 页面内锚点 #/checkin#countdown（倒数日以前是打卡页里的一节）：打开倒数日页
  const [a, anchor] = (rawA ?? '').split('#');
  if (a === 'checkin' && (anchor === 'countdown' || anchor === 'countdowns')) return { page: 'countdown' };
  switch (a) {
    case 'agenda':
      return { page: 'agenda' };
    case 'backlog':
      return { page: 'backlog' };
    case 'groups':
    case 'projects': // 界面上「组」改叫「项目」（Rei 2026-10-25）：#/projects 是别名，链接仍生成 #/groups
      return b ? { page: 'group', id: b } : { page: 'groups' };
    case 'people':
      return b ? { page: 'person', id: b } : { page: 'people' };
    case 'library':
      return c && b ? { page: 'libitem', typeId: b, id: c } : b ? { page: 'library', typeId: b } : { page: 'library' };
    case 'doable':
      return { page: 'doable' };
    case 'checkin':
      // 旧写法 #/checkin/countdown（倒数日以前在打卡页里）：打开倒数日页
      return b === 'countdown' || b === 'countdowns' ? { page: 'countdown' } : { page: 'checkin' };
    case 'countdown':
    case 'countdowns':
      return { page: 'countdown' };
    case 'journal':
      return b && b !== 'today' ? { page: 'journal', date: decodeURIComponent(b) } : { page: 'journal' };
    case 'settings':
      return isSettingsSection(b) ? { page: 'settings', section: b } : { page: 'settings' };
    case 'types':
    case 'categories':
      return b ? { page: 'types', id: decodeURIComponent(b) } : { page: 'types' };
    case 'more':
      return { page: 'more' };
    default:
      return { page: 'myday' };
  }
}

export function href(route: Route): string {
  switch (route.page) {
    case 'group':
      return `#/groups/${route.id}`;
    case 'person':
      return `#/people/${route.id}`;
    case 'library':
      return route.typeId ? `#/library/${route.typeId}` : '#/library';
    case 'libitem':
      return `#/library/${route.typeId}/${route.id}`;
    case 'journal':
      return route.date ? `#/journal/${route.date}` : '#/journal';
    case 'settings':
      return route.section ? `#/settings/${route.section}` : '#/settings';
    case 'types':
      return route.id ? `#/types/${route.id}` : '#/types';
    default:
      return `#/${route.page}`;
  }
}

/**
 * 三列布局里选中的任务（Rei 2026-10-23「任务详情如果不弹窗最好了，最好做成三列布局」）：
 * 写在当前页面 hash 的 ?task=<id> 上（#/agenda?task=…），刷新后还在；换页面（navigate）就不带了。
 */
export function taskInHash(hash: string): string | null {
  const h = hash.replace(/^#/, '');
  const qi = h.indexOf('?');
  if (qi < 0) return null;
  const id = new URLSearchParams(h.slice(qi + 1)).get('task');
  return id ? id : null;
}

/** 当前 hash 换上（或去掉）选中的任务，其他参数和路径不变。没有路径时当作我的一天。 */
export function hashWithTask(hash: string, id: string | null): string {
  const h = hash.replace(/^#/, '');
  const qi = h.indexOf('?');
  const path = (qi >= 0 ? h.slice(0, qi) : h) || '/myday';
  const q = new URLSearchParams(qi >= 0 ? h.slice(qi + 1) : '');
  if (id) q.set('task', id);
  else q.delete('task');
  const qs = q.toString();
  return `#${path}${qs ? `?${qs}` : ''}`;
}

export function navigate(route: Route) {
  location.hash = href(route);
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(location.hash));
  useEffect(() => {
    // 只是 ?task= 变了：路由对象不换，页面不用重来
    const on = () => {
      const next = parseHash(location.hash);
      setRoute((cur) => (JSON.stringify(cur) === JSON.stringify(next) ? cur : next));
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
