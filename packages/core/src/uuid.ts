/** UUIDv7（RFC 9562）：48 位毫秒时间戳 + 版本 + 74 位随机，按生成时间可排序。 */

export type RandomFill = (bytes: Uint8Array) => Uint8Array;

interface CryptoLike {
  getRandomValues<T extends Uint8Array>(array: T): T;
}

const defaultFill: RandomFill = (bytes) => {
  const c = (globalThis as unknown as { crypto?: CryptoLike }).crypto;
  if (c?.getRandomValues) return c.getRandomValues(bytes);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return bytes;
};

let lastMs = -1;
let seq = 0;

/**
 * 生成 UUIDv7。同一毫秒内用 rand_a 的 12 位作单调计数，保证同进程内严格递增。
 */
export function uuidv7(now: number = Date.now(), fill: RandomFill = defaultFill): string {
  const bytes = fill(new Uint8Array(16));
  let ms = Math.floor(now);
  if (ms <= lastMs) {
    ms = lastMs;
    seq++;
    if (seq > 0xfff) {
      ms = lastMs + 1;
      seq = 0;
    }
  } else {
    seq = (bytes[6]! & 0x07) << 8 | bytes[7]!; // 随机起点，留出递增空间
  }
  lastMs = ms;
  // 48 位时间戳
  bytes[0] = Math.floor(ms / 2 ** 40) & 0xff;
  bytes[1] = Math.floor(ms / 2 ** 32) & 0xff;
  bytes[2] = (ms >>> 24) & 0xff;
  bytes[3] = (ms >>> 16) & 0xff;
  bytes[4] = (ms >>> 8) & 0xff;
  bytes[5] = ms & 0xff;
  // 版本 7 + 12 位计数
  bytes[6] = 0x70 | ((seq >>> 8) & 0x0f);
  bytes[7] = seq & 0xff;
  // RFC 变体 10xx
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isUuidv7(id: string): boolean {
  return UUID_RE.test(id);
}

/** 取出 UUIDv7 内的毫秒时间戳。 */
export function uuidv7Time(id: string): number {
  const hex = id.replace(/-/g, '').slice(0, 12);
  return parseInt(hex, 16);
}
