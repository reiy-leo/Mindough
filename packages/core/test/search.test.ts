import { describe, expect, it } from 'vitest';
import { search } from '../src/search';
import { BUILTIN_TASK_TYPES, BUILTIN_TYPE_IDS } from '../src/seed/builtin-types';
import type { Group, Person, TaskPerson } from '../src/types';
import { mkTask } from './helpers';

const base = { updated_at: '', deleted: false };
const people: Person[] = [{ ...base, id: 'p1', name: '小林', avatar_asset_id: null, relation: '朋友', birthday: null, note_md: '' }];
const groups: Group[] = [{ ...base, id: 'g1', name: '搬家', icon: '🏠', start_at: null, end_at: null, category_id: null, default_type_id: null }];
const taskPeople: TaskPerson[] = [{ ...base, id: 'tp', task_id: 't3', person_id: 'p1' }];
const tasks = [
  mkTask('t1', { body_md: '打包书和衣服', group_id: 'g1' }),
  mkTask('t2', { body_md: '## 想看理由', type_id: BUILTIN_TYPE_IDS.movie, type_data: { title: '沙丘 2' } }),
  mkTask('t3', { body_md: '一起跑步' }),
  mkTask('t4', { body_md: '已删除的沙丘', deleted: true }),
];
const input = { tasks, types: BUILTIN_TASK_TYPES, people, groups, taskPeople };

describe('全局搜索', () => {
  it('搜类型字段（片名）', () => {
    const hits = search(input, '沙丘');
    expect(hits.map((h) => h.id)).toEqual(['t2']);
    expect(hits[0]!.title).toBe('沙丘 2');
    expect(hits[0]!.snippet).not.toContain('#');
  });

  it('搜人物：命中人物本身和关联的任务', () => {
    const hits = search(input, '小林');
    expect(hits.map((h) => `${h.kind}:${h.id}`).sort()).toEqual(['person:p1', 'task:t3']);
  });

  it('搜组名：命中组和组里的任务；多个词须同时命中', () => {
    expect(search(input, '搬家').map((h) => h.kind).sort()).toEqual(['group', 'task']);
    expect(search(input, '打包 衣服').map((h) => h.id)).toEqual(['t1']);
    expect(search(input, '打包 不存在')).toEqual([]);
    expect(search(input, '  ')).toEqual([]);
  });
});
