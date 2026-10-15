import { useEffect, useState } from 'react';

export type Route =
  | { page: 'myday' }
  | { page: 'agenda' }
  | { page: 'groups' }
  | { page: 'group'; id: string }
  | { page: 'people' }
  | { page: 'person'; id: string }
  | { page: 'graph' }
  | { page: 'doable' }
  | { page: 'checkin' }
  | { page: 'settings' }
  | { page: 'more' };

export function parseHash(hash: string): Route {
  const [, a, b] = hash.replace(/^#/, '').split('/');
  switch (a) {
    case 'agenda':
      return { page: 'agenda' };
    case 'groups':
      return b ? { page: 'group', id: b } : { page: 'groups' };
    case 'people':
      return b ? { page: 'person', id: b } : { page: 'people' };
    case 'graph':
      return { page: 'graph' };
    case 'doable':
      return { page: 'doable' };
    case 'checkin':
      return { page: 'checkin' };
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
