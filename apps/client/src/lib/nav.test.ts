import { describe, expect, it } from 'vitest';
import { BUILTIN_TYPE_IDS as T } from '@mindough/core';
import { activeGroupEntry, activeLibraryEntry, groupIconName, libraryRoute, manageEntries, planEntries, routeLibraryId } from './nav';
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

describe('侧边栏「计划」一节里的项目（Rei 2026-10-28）', () => {
  it('列表、项目，放进侧边栏的项目排在「项目」下面', () => {
    expect(planEntries([])).toEqual([{ kind: 'agenda' }, { kind: 'groups' }]);
    expect(planEntries([{ id: 'g1' }, { id: 'g2' }])).toEqual([
      { kind: 'agenda' },
      { kind: 'groups' },
      { kind: 'pinned', groupId: 'g1' },
      { kind: 'pinned', groupId: 'g2' },
    ]);
  });

  it('点了直接打开项目：#/groups/<id>', () => {
    expect(href({ page: 'group', id: 'g1' })).toBe('#/groups/g1');
  });

  it('高亮：放进侧边栏的项目亮它自己，项目列表和别的项目亮「项目」', () => {
    expect(activeGroupEntry({ page: 'myday' }, ['g1'])).toBeNull();
    expect(activeGroupEntry({ page: 'groups' }, ['g1'])).toBe('groups');
    expect(activeGroupEntry({ page: 'group', id: 'g1' }, ['g1'])).toBe('g1');
    expect(activeGroupEntry({ page: 'group', id: 'g2' }, ['g1'])).toBe('groups');
  });

  it('项目图标：emoji 原样、lucide: 前缀去掉、空的给文件夹', () => {
    expect(groupIconName('🏠')).toBe('🏠');
    expect(groupIconName('lucide:home')).toBe('home');
    expect(groupIconName('')).toBe('📁');
    expect(groupIconName(null)).toBe('📁');
  });
});
