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

export function parseHash(hash: string): Route {
  const [, a, b, c] = hash.replace(/^#/, '').split('/');
  switch (a) {
    case 'agenda':
      return { page: 'agenda' };
    case 'backlog':
      return { page: 'backlog' };
    case 'groups':
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

export function navigate(route: Route) {
  location.hash = href(route);
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(location.hash));
  useEffect(() => {
    const on = () => setRoute(parseHash(location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
