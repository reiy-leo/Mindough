import { describe, expect, it } from 'vitest';
import { episodeOf, findEpisode, formatEpisode, normalizeEpisodeInput, parseCnNumber, stripEpisode } from '../src/episode';
import { fieldText } from '../src/preview';
import { BUILTIN_TASK_TYPES, BUILTIN_TYPE_IDS as T } from '../src/seed/builtin-types';

describe('看到哪：认出第几季第几集', () => {
  it('中文数字', () => {
    expect(parseCnNumber('三')).toBe(3);
    expect(parseCnNumber('十')).toBe(10);
    expect(parseCnNumber('十二')).toBe(12);
    expect(parseCnNumber('二十')).toBe(20);
    expect(parseCnNumber('二十三')).toBe(23);
    expect(parseCnNumber('一百零五')).toBe(105);
    expect(parseCnNumber('两')).toBe(2);
    expect(parseCnNumber('12')).toBe(12);
    expect(parseCnNumber('abc')).toBeNull();
  });

  const cases: Array<[string, { season?: number; episode?: number }]> = [
    ['S02E03', { season: 2, episode: 3 }],
    ['s2e3', { season: 2, episode: 3 }],
    ['S2 E3', { season: 2, episode: 3 }],
    ['S02.E03', { season: 2, episode: 3 }],
    ['S1EP12', { season: 1, episode: 12 }],
    ['2x03', { season: 2, episode: 3 }],
    ['第2季第3集', { season: 2, episode: 3 }],
    ['第 2 季 第 3 集', { season: 2, episode: 3 }],
    ['第二季第三集', { season: 2, episode: 3 }],
    ['第十二季第二十三集', { season: 12, episode: 23 }],
    ['第2季3集', { season: 2, episode: 3 }],
    ['Ｓ０２Ｅ０３', { season: 2, episode: 3 }],
    ['EP03', { episode: 3 }],
    ['Ep 7', { episode: 7 }],
    ['E03', { episode: 3 }],
    ['第3集', { episode: 3 }],
    ['第十集', { episode: 10 }],
    ['S02', { season: 2 }],
    ['第二季', { season: 2 }],
    ['Season 3', { season: 3 }],
  ];
  for (const [text, want] of cases)
    it(`「${text}」`, () => {
      expect(findEpisode(text)?.value).toEqual(want);
    });

  it('不是季集的不误认', () => {
    for (const s of ['绝命毒师', '1920x1080', 'Windows 11', 'WALL-E 3', 'BS02E03X', 'Mass Effect 2', '沙丘 2', 'iPhone 15 Pro']) expect(findEpisode(s), s).toBeNull();
  });

  it('从名字里拿掉：搜索 / 新建用剩下的名字', () => {
    expect(stripEpisode('绝命毒师 S02E03')).toMatchObject({ rest: '绝命毒师', match: { value: { season: 2, episode: 3 }, raw: 'S02E03' } });
    expect(stripEpisode('繁花 第二季第三集').rest).toBe('繁花');
    expect(stripEpisode('The Bear - S03E01').rest).toBe('The Bear');
    expect(stripEpisode('S01E01 漫长的季节').rest).toBe('漫长的季节');
    expect(stripEpisode('沙丘 2')).toEqual({ rest: '沙丘 2', match: null });
  });

  it('显示与输入：整段是标记才结构化，其他写法原样留着', () => {
    expect(formatEpisode({ season: 2, episode: 3 })).toBe('第 2 季第 3 集');
    expect(formatEpisode({ episode: 3 })).toBe('第 3 集');
    expect(formatEpisode({ season: 2 })).toBe('第 2 季');
    expect(normalizeEpisodeInput('S02E03')).toEqual({ season: 2, episode: 3 });
    expect(normalizeEpisodeInput(' 第二季第三集 ')).toEqual({ season: 2, episode: 3 });
    expect(normalizeEpisodeInput('看到片尾彩蛋')).toBe('看到片尾彩蛋');
    expect(normalizeEpisodeInput('')).toBeNull();
    expect(episodeOf('第 2 季第 3 集')).toEqual({ season: 2, episode: 3 });
    expect(episodeOf('随便')).toBeNull();
    expect(fieldText({ season: 2, episode: 3 })).toBe('第 2 季第 3 集');
    expect(fieldText('第 12 集')).toBe('第 12 集');
  });

  it('影视的「看到哪」是 episode 字段（任务字段）', () => {
    const f = BUILTIN_TASK_TYPES.find((t) => t.id === T.movie)!.fields.find((x) => x.key === 'episode')!;
    expect(f).toMatchObject({ kind: 'episode', scope: 'task' });
  });
});
