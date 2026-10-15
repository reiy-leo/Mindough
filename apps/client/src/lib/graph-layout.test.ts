import { describe, expect, it } from 'vitest';
import { relatedClusters } from './graph-layout';

describe('关系图：相关任务并排', () => {
  it('相关的几件合成一组，按原来的顺序', () => {
    expect(relatedClusters(['a', 'b', 'c', 'd'], [], [{ a: 'c', b: 'a' }, { a: 'a', b: 'd' }])).toEqual([['a', 'c', 'd']]);
  });
  it('有前后关系路径的两件不合（会绕圈），只画线', () => {
    // a → x → b，a 和 b 相关：不并排
    expect(relatedClusters(['a', 'x', 'b'], [{ pred_id: 'a', succ_id: 'x' }, { pred_id: 'x', succ_id: 'b' }], [{ a: 'a', b: 'b' }])).toEqual([]);
  });
  it('各自在不同链上的两件可以并排', () => {
    const edges = [{ pred_id: 'p', succ_id: 'a' }, { pred_id: 'q', succ_id: 'b' }];
    expect(relatedClusters(['p', 'q', 'a', 'b'], edges, [{ a: 'a', b: 'b' }])).toEqual([['a', 'b']]);
  });
  it('不在图里的不算', () => {
    expect(relatedClusters(['a'], [], [{ a: 'a', b: 'z' }])).toEqual([]);
  });
});
