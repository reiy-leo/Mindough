/**
 * 侧边栏「管理」一节里资料库相关入口的纯逻辑（Rei 2026-10-26）。
 * - 「人物」不再单独占一项（18:54「侧边栏的：管理-人物入口删掉」），人物页、#/people、深链、⌘K 都照旧；
 *   在人物页 / 人物详情时，高亮「资料库」（或放进侧边栏的人物库）。
 * - 资料库可以「在侧边栏显示」（18:55），显示的库排在「资料库」下面，点了直接进那个库。
 */
import { BUILTIN_TYPE_IDS } from '@mindough/core';
import type { Route } from './router';

/** 打开某个库的路由：人物库走 #/people（和资料库标签条一致）。 */
export function libraryRoute(typeId: string): Route {
  return typeId === BUILTIN_TYPE_IDS.person ? { page: 'people' } : { page: 'library', typeId };
}

/** 当前路由属于哪个库（看库、看库里的一条、人物页、人物详情）；资料库首页没带库、或别的页面是 null。 */
export function routeLibraryId(route: Route): string | null {
  switch (route.page) {
    case 'library':
      return route.typeId ?? null;
    case 'libitem':
      return route.typeId;
    case 'people':
    case 'person':
      return BUILTIN_TYPE_IDS.person;
    default:
      return null;
  }
}

/** 是不是资料库这一片的页面。 */
export function isLibraryRoute(route: Route): boolean {
  return route.page === 'library' || route.page === 'libitem' || route.page === 'people' || route.page === 'person';
}

/**
 * 侧边栏里哪个入口亮：放进侧边栏的那个库亮它自己，其他资料库页面都亮「资料库」。
 * 返回 'library'、某个库的 id，或 null（不在资料库页面）。
 */
export function activeLibraryEntry(route: Route, pinnedIds: readonly string[]): string | null {
  if (!isLibraryRoute(route)) return null;
  const id = routeLibraryId(route);
  return id && pinnedIds.includes(id) ? id : 'library';
}

/** 「管理」一节的入口，按顺序：资料库、放进侧边栏的库（按资料库顺序，调用方传 store.sidebarLibraries()）、类型。没有「人物」。 */
export type ManageEntry = { kind: 'library' } | { kind: 'pinned'; typeId: string } | { kind: 'types' };
export function manageEntries(pinned: ReadonlyArray<{ id: string }>): ManageEntry[] {
  return [{ kind: 'library' }, ...pinned.map((t) => ({ kind: 'pinned' as const, typeId: t.id })), { kind: 'types' }];
}
