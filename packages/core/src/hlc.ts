/**
 * 混合逻辑时钟（HLC）。字符串格式：
 *   <13 位毫秒，左补 0>-<4 位 16 进制计数>-<device_id>
 * 字典序比较即可得到全序；用于 updated_at 与字段级 LWW。
 */
import type { Hlc } from './types';

export interface HlcState {
  ms: number;
  counter: number;
}

export function formatHlc(ms: number, counter: number, deviceId: string): Hlc {
  return `${String(ms).padStart(13, '0')}-${counter.toString(16).padStart(4, '0')}-${deviceId}`;
}

export function parseHlc(hlc: Hlc): { ms: number; counter: number; deviceId: string } {
  const [ms, counter, ...rest] = hlc.split('-');
  return { ms: Number(ms), counter: parseInt(counter ?? '0', 16), deviceId: rest.join('-') };
}

export function compareHlc(a: Hlc, b: Hlc): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export class HlcClock {
  private state: HlcState = { ms: 0, counter: 0 };
  constructor(
    readonly deviceId: string,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** 本地事件：生成新的时间戳。 */
  tick(): Hlc {
    const wall = this.now();
    if (wall > this.state.ms) this.state = { ms: wall, counter: 0 };
    else this.state = { ms: this.state.ms, counter: this.state.counter + 1 };
    return formatHlc(this.state.ms, this.state.counter, this.deviceId);
  }

  /** 收到远端时间戳时推进本地时钟（同步时用）。 */
  receive(remote: Hlc): Hlc {
    const r = parseHlc(remote);
    const wall = this.now();
    const ms = Math.max(wall, this.state.ms, r.ms);
    let counter: number;
    if (ms === this.state.ms && ms === r.ms) counter = Math.max(this.state.counter, r.counter) + 1;
    else if (ms === this.state.ms) counter = this.state.counter + 1;
    else if (ms === r.ms) counter = r.counter + 1;
    else counter = 0;
    this.state = { ms, counter };
    return formatHlc(ms, counter, this.deviceId);
  }
}
