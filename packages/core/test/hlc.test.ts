import { describe, expect, it } from 'vitest';
import { HlcClock, compareHlc, formatHlc, parseHlc } from '../src/hlc';

describe('HLC', () => {
  it('格式化与解析互逆', () => {
    const h = formatHlc(1760500000000, 3, 'dev-a');
    expect(parseHlc(h)).toEqual({ ms: 1760500000000, counter: 3, deviceId: 'dev-a' });
  });

  it('墙钟不动时计数递增，仍单调', () => {
    const clock = new HlcClock('a', () => 1000);
    const a = clock.tick();
    const b = clock.tick();
    expect(compareHlc(a, b)).toBe(-1);
    expect(parseHlc(b).counter).toBe(1);
  });

  it('墙钟回拨不倒退', () => {
    let wall = 5000;
    const clock = new HlcClock('a', () => wall);
    const a = clock.tick();
    wall = 1000;
    expect(clock.tick() > a).toBe(true);
  });

  it('收到更晚的远端时间戳后本地时间戳超过它', () => {
    const clock = new HlcClock('a', () => 1000);
    const remote = formatHlc(9000, 5, 'b');
    const r = clock.receive(remote);
    expect(r > remote).toBe(true);
    expect(clock.tick() > r).toBe(true);
  });

  it('字典序即全序', () => {
    expect(formatHlc(999, 0, 'z') < formatHlc(1000, 0, 'a')).toBe(true);
  });
});
