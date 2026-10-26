import { describe, expect, it } from 'vitest';
import { projectChains, taskChain, type Edge } from '../src/dag';

const e = (pred_id: string, succ_id: string): Edge => ({ pred_id, succ_id });

describe('项目页任务链 projectChains（Rei 2026-10-26）', () => {
  it('按依赖排成链，没有前后关系的放 single', () => {
    const r = projectChains(['a', 'b', 'c', 'x'], [e('a', 'b'), e('b', 'c')]);
    expect(r.chains).toHaveLength(1);
    expect(r.chains[0]!.layers).toEqual([['a'], ['b'], ['c']]);
    expect(r.single).toEqual(['x']);
  });

  it('分叉、汇合留在同一条链，层号和详情任务链一样（最长路径）', () => {
    const deps = [e('a', 'b'), e('a', 'c'), e('b', 'd'), e('c', 'd'), e('a', 'd')];
    const r = projectChains(['d', 'c', 'b', 'a'], deps);
    expect(r.chains).toHaveLength(1);
    expect(r.chains[0]!.layers).toEqual(taskChain('d', deps).layers);
    expect(r.chains[0]!.layers).toEqual([['a'], ['b', 'c'], ['d']]);
  });

  it('跨项目的前置 / 后续也在链上，链不断开', () => {
    // a、c 在本项目；b 在别的项目，夹在中间；z 是 c 后面别的项目的任务
    const r = projectChains(['a', 'c'], [e('a', 'b'), e('b', 'c'), e('c', 'z')]);
    expect(r.chains).toHaveLength(1);
    expect(r.chains[0]!.ids).toEqual(['a', 'b', 'c', 'z']);
  });

  it('不连通的是两条链；链的先后看链首那件本项目任务在排序里的位置，链内只看依赖', () => {
    const deps = [e('a', 'b'), e('p', 'q')];
    // 排序把 q 放最前：q 那条链的链首本项目任务是 p，p 在 a 之后，所以 a 链在前
    expect(projectChains(['q', 'a', 'p', 'b'], deps).chains.map((c) => c.ids)).toEqual([
      ['a', 'b'],
      ['p', 'q'],
    ]);
    // p 排到 a 前面，p 链跟着到前面；链内顺序不变
    expect(projectChains(['p', 'q', 'b', 'a'], deps).chains.map((c) => c.ids)).toEqual([
      ['p', 'q'],
      ['a', 'b'],
    ]);
  });

  it('删掉的边、删掉的任务不算', () => {
    const tasks = [
      { id: 'a', status: '待办' as const, deleted: false },
      { id: 'b', status: '待办' as const, deleted: true },
      { id: 'c', status: '待办' as const, deleted: false },
    ];
    const r = projectChains(['a', 'b', 'c'], [e('a', 'b'), { ...e('a', 'c'), deleted: true }], tasks);
    expect(r.chains).toEqual([]);
    expect(r.single).toEqual(['a', 'c']);
  });

  it('不会顺着别的项目的兄弟任务把无关的链拉进来', () => {
    // a → b（本项目）；别的项目里 m → b 也接到 b 上：m 是 b 的上游，算在链里；n 是 m 的另一个后续，跟本项目无关，不算
    const r = projectChains(['a', 'b'], [e('a', 'b'), e('m', 'b'), e('m', 'n')]);
    expect(r.chains[0]!.ids.sort()).toEqual(['a', 'b', 'm']);
  });
});
