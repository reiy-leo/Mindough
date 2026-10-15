import { describe, expect, it } from 'vitest';
import { detectPlatform, layoutForWidth, resolveSkin, skinForPlatform } from './platform';

const UA = {
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  win: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 Edg/140.0',
  android: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36',
  linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
};

describe('平台检测', () => {
  it('按 userAgent 识别', () => {
    expect(detectPlatform({ userAgent: UA.mac })).toBe('macos');
    expect(detectPlatform({ userAgent: UA.iphone })).toBe('ios');
    expect(detectPlatform({ userAgent: UA.win })).toBe('windows');
    expect(detectPlatform({ userAgent: UA.android })).toBe('android'); // UA 里也有 Linux
    expect(detectPlatform({ userAgent: UA.linux })).toBe('linux');
    expect(detectPlatform({ userAgent: '' })).toBe('unknown');
  });

  it('iPadOS 桌面模式按触点识别为 iOS', () => {
    expect(detectPlatform({ userAgent: UA.mac, maxTouchPoints: 5 })).toBe('ios');
  });

  it('皮肤映射与手动覆盖', () => {
    expect(skinForPlatform('macos')).toBe('apple');
    expect(skinForPlatform('ios')).toBe('apple');
    expect(skinForPlatform('windows')).toBe('winui');
    expect(skinForPlatform('android')).toBe('material');
    expect(resolveSkin('auto', 'windows')).toBe('winui');
    expect(resolveSkin('apple', 'windows')).toBe('apple');
  });

  it('布局按宽度', () => {
    expect(layoutForWidth(390)).toBe('mobile');
    expect(layoutForWidth(1280)).toBe('desktop');
  });
});
