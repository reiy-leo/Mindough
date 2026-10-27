import { describe, expect, it } from 'vitest';
import { Store } from '../src/store';
import { MemoryAdapter } from '../src/storage/memory';
import { BUILTIN_CATEGORIES, BUILTIN_CATEGORY_GROUPS, BUILTIN_CATEGORY_IDS } from '../src/seed/builtin-checkin-categories';
import {
  CATEGORY_GROUPS,
  categoryGroupOverrides,
  categoryLastUsed,
  categoryMatches,
  categoryMatchRank,
  categoryStateOf,
  frequentCategoryIds,
  orderPickerCategories,
  withCategoryGroup,
  withCategoryState,
} from '../src/category-prefs';

describe('大类', () => {
  it('内置 27 个都有默认组，5 组的名单和文档一致', () => {
    expect(BUILTIN_CATEGORIES.every((c) => BUILTIN_CATEGORY_GROUPS[c.id])).toBe(true);
    const names = (g: string) => BUILTIN_CATEGORIES.filter((c) => BUILTIN_CATEGORY_GROUPS[c.id] === g).map((c) => c.name).sort();
    expect(names('body')).toEqual(['健康', '运动', '作息', '冥想', '服药', '护肤', '个人护理', '饮食'].sort());
    expect(names('life')).toEqual(['整理', '清洁', '采购', '维护', '植物', '宠物', '理财'].sort());
    expect(names('study')).toEqual(['学习', '读书', '写作', '语言', '工作', '记录'].sort());
    expect(names('hobby')).toEqual(['游戏', '玩乐', '观影', '乐器', '创作'].sort());
    expect(names('people')).toEqual(['社交']);
    expect(CATEGORY_GROUPS.at(-1)).toBe('other');
  });

  it('偏好读写：坏值丢掉；改回默认组就去掉那一项', () => {
    expect(categoryGroupOverrides(['a=life', 'b=nope', 3, '=body', 'a=hobby']).get('a')).toBe('hobby');
    expect(categoryGroupOverrides(null).size).toBe(0);
    const sport = BUILTIN_CATEGORY_IDS.sport;
    const v = withCategoryGroup([], sport, 'hobby');
    expect(v).toEqual([`${sport}=hobby`]);
    expect(withCategoryGroup(v, sport, 'body')).toEqual([]);
    expect(withCategoryGroup([], 'custom', 'other')).toEqual([]);
    expect(withCategoryGroup([], 'custom', 'life')).toEqual(['custom=life']);
  });
});

describe('三档', () => {
  it('不显示优先；常用看列表', () => {
    expect(categoryStateOf({ id: 'a', hidden: true }, ['a'])).toBe('hidden');
    expect(categoryStateOf({ id: 'a', hidden: false }, ['a'])).toBe('frequent');
    expect(categoryStateOf({ id: 'a', hidden: false }, [])).toBe('normal');
    expect(withCategoryState(['a', 'b'], 'a', 'frequent')).toEqual(['b', 'a']);
    expect(withCategoryState(['a', 'b'], 'a', 'hidden')).toEqual(['b']);
    expect(frequentCategoryIds(['a', 'a', 1, ''])).toEqual(['a']);
  });

  it('Store：设成不显示会出常用列表，返回之前的档好撤销', async () => {
    const s = await Store.open(new MemoryAdapter(), { deviceId: 'a' });
    const c = s.createCategory('旅行');
    expect(s.setCategoryState(c.id, 'frequent')).toBe('normal');
    expect(s.categoryState(c.id)).toBe('frequent');
    expect(s.pickerCategories()[0]!.id).toBe(c.id);
    expect(s.setCategoryState(c.id, 'hidden')).toBe('frequent');
    expect(s.category(c.id)?.hidden).toBe(true);
    expect(s.frequentCategoryIds()).toEqual([]);
    expect(s.pickerCategories().some((x) => x.id === c.id)).toBe(false);
    s.setCategoryState(c.id, 'frequent');
    expect(s.category(c.id)?.hidden).toBe(false);
    expect(s.categoryState(c.id)).toBe('frequent');
    // 换组
    expect(s.categoryGroup(c.id)).toBe('other');
    s.setCategoryGroup(c.id, 'life');
    expect(s.categoryGroup(c.id)).toBe('life');
  });
});

describe('选择器顺序：常用 + 最近用过', () => {
  const cats = BUILTIN_CATEGORIES.map((c) => ({ ...c }));
  const id = (k: keyof typeof BUILTIN_CATEGORY_IDS) => BUILTIN_CATEGORY_IDS[k];
  it('常用在前，用过的按最近，没用过的先放日常几个再按组', () => {
    const last = new Map([
      [id('game'), '2026-10-01T00:00:00Z'],
      [id('finance'), '2026-10-20T00:00:00Z'],
    ]);
    const names = orderPickerCategories(cats, [id('watch')], last).map((c) => c.name);
    expect(names.slice(0, 3)).toEqual(['观影', '理财', '游戏']);
    expect(names.slice(3, 9)).toEqual(['健康', '运动', '学习', '读书', '饮食', '作息']);
    expect(names).toHaveLength(27);
    expect(new Set(names).size).toBe(27);
  });

  it('最近用过：任务创建和打卡记录取最晚的', () => {
    const m = categoryLastUsed(
      [
        { id: 't1', category: 'a', created_at: '2026-01-01' },
        { id: 't2', category: 'b', created_at: '2026-05-01' },
        { id: 't3', category: null, created_at: '2026-09-01' },
      ],
      [{ task_id: 't1', at: '2026-10-01' }],
    );
    expect(m.get('a')).toBe('2026-10-01');
    expect(m.get('b')).toBe('2026-05-01');
    expect(m.size).toBe(2);
  });

  it('Store：新建一个类型，用一次就靠前，不用手排', async () => {
    const s = await Store.open(new MemoryAdapter(), { deviceId: 'a' });
    const c = s.createCategory('装修');
    expect(s.pickerCategories().at(-1)!.id).toBe(c.id);
    s.createTask({ category_id: c.id });
    expect(s.pickerCategories()[0]!.id).toBe(c.id);
    expect(s.frequentCategories(6)).toHaveLength(6);
  });
});

describe('搜索', () => {
  it('中文、拼音首字母、全拼、英文名都能搜', () => {
    expect(categoryMatches(['运动', 'Exercise'], '运')).toBe(true);
    expect(categoryMatches(['运动', 'Exercise'], 'yd')).toBe(true);
    expect(categoryMatches(['运动', 'Exercise'], 'YD')).toBe(true);
    expect(categoryMatches(['运动', 'Exercise'], 'yundong')).toBe(true);
    expect(categoryMatches(['运动', 'Exercise'], 'exer')).toBe(true);
    expect(categoryMatches(['运动', 'Exercise'], 'xx')).toBe(false);
    // 多音字：乐器 yq、玩乐 wl
    expect(categoryMatches(['乐器'], 'yq')).toBe(true);
    expect(categoryMatches(['玩乐'], 'wl')).toBe(true);
    expect(categoryMatches(['个人护理'], 'hl')).toBe(true);
    expect(categoryMatches(['运动'], '')).toBe(true);
  });
  it('排序分：开头 < 包含 < 拼音', () => {
    expect(categoryMatchRank(['运动'], '运')).toBe(0);
    expect(categoryMatchRank(['运动'], '动')).toBe(1);
    expect(categoryMatchRank(['运动'], 'yd')).toBe(2);
  });
});
