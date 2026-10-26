import { describe, expect, it } from 'vitest';
import { BUILTIN_TYPE_IDS as T } from '@mindough/core';
import { activeLibraryEntry, libraryRoute, manageEntries, routeLibraryId } from './nav';
import { href, parseHash } from './router';

describe('侧边栏「管理」一节（Rei 2026-10-26）', () => {
  it('没有「人物」入口：资料库、放进侧边栏的库、类型', () => {
    expect(manageEntries([])).toEqual([{ kind: 'library' }, { kind: 'types' }]);
    expect(manageEntries([{ id: T.movie }, { id: T.person }])).toEqual([
      { kind: 'library' },
      { kind: 'pinned', typeId: T.movie },
      { kind: 'pinned', typeId: T.person },
      { kind: 'types' },
    ]);
  });

  it('人物页照旧能打开：#/people、#/people/<id> 路由还在', () => {
    expect(parseHash('#/people')).toEqual({ page: 'people' });
    expect(parseHash('#/people/p1')).toEqual({ page: 'person', id: 'p1' });
  });

  it('库的入口地址：人物库走 #/people，其他走 #/library/<id>', () => {
    expect(href(libraryRoute(T.person))).toBe('#/people');
    expect(href(libraryRoute(T.movie))).toBe(`#/library/${T.movie}`);
  });

  it('当前路由属于哪个库', () => {
    expect(routeLibraryId({ page: 'library' })).toBeNull();
    expect(routeLibraryId({ page: 'library', typeId: T.book })).toBe(T.book);
    expect(routeLibraryId({ page: 'libitem', typeId: T.book, id: 'x' })).toBe(T.book);
    expect(routeLibraryId({ page: 'person', id: 'p' })).toBe(T.person);
    expect(routeLibraryId({ page: 'myday' })).toBeNull();
  });

  it('高亮：放进侧边栏的库亮它自己，其余资料库页面（含人物页）亮「资料库」', () => {
    expect(activeLibraryEntry({ page: 'myday' }, [T.movie])).toBeNull();
    expect(activeLibraryEntry({ page: 'library' }, [T.movie])).toBe('library');
    expect(activeLibraryEntry({ page: 'library', typeId: T.movie }, [T.movie])).toBe(T.movie);
    expect(activeLibraryEntry({ page: 'libitem', typeId: T.movie, id: 'x' }, [T.movie])).toBe(T.movie);
    expect(activeLibraryEntry({ page: 'library', typeId: T.book }, [T.movie])).toBe('library');
    expect(activeLibraryEntry({ page: 'people' }, [])).toBe('library');
    expect(activeLibraryEntry({ page: 'person', id: 'p' }, [T.person])).toBe(T.person);
  });
});
