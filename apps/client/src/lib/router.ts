import { useEffect, useState } from 'react';

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
  /** 日记：date 省略 = 今天（按「一天从几点开始」算）。 */
  | { page: 'journal'; date?: string }
  | { page: 'settings' }
  | { page: 'more' };

/** hash 里 ? 之前的路径部分（?task= 等参数不算路由）。 */
function hashPath(hash: string): string {
  const h = hash.replace(/^#/, '');
  const qi = h.indexOf('?');
  return qi >= 0 ? h.slice(0, qi) : h;
}

export function parseHash(hash: string): Route {
  const [, a, b, c] = hashPath(hash).split('/');
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
      return { page: 'checkin' };
    case 'journal':
      return b && b !== 'today' ? { page: 'journal', date: decodeURIComponent(b) } : { page: 'journal' };
    case 'settings':
      return { page: 'settings' };
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
