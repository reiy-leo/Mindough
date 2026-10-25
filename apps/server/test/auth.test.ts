/**
 * 原生端登录结果页的语言（Rei 2026-10-25 加了西、葡、俄、日、德、法、印尼七种）：
 * 按 Accept-Language 的权重找第一个认得的语言，认不出用英文。
 */
import { describe, expect, it } from 'vitest';
import { nativeLang, nativeResult, NATIVE_RETURN } from '../src/auth';

describe('nativeLang（Accept-Language → 结果页语言）', () => {
  it('没带或认不出 → 英文', () => {
    expect(nativeLang(null)).toBe('en');
    expect(nativeLang(undefined)).toBe('en');
    expect(nativeLang('')).toBe('en');
    expect(nativeLang('ko-KR,it;q=0.8')).toBe('en');
    expect(nativeLang('*')).toBe('en');
  });

  it('九种语言都认得，地区码不影响', () => {
    expect(nativeLang('zh-CN,zh;q=0.9')).toBe('zh');
    expect(nativeLang('zh-TW')).toBe('zh');
    expect(nativeLang('en-GB')).toBe('en');
    expect(nativeLang('es-MX')).toBe('es');
    expect(nativeLang('pt-PT')).toBe('pt');
    expect(nativeLang('pt-BR')).toBe('pt');
    expect(nativeLang('ru')).toBe('ru');
    expect(nativeLang('ja-JP')).toBe('ja');
    expect(nativeLang('de-AT')).toBe('de');
    expect(nativeLang('FR-ca')).toBe('fr');
    expect(nativeLang('id-ID')).toBe('id');
  });

  it('印尼语旧代码 in 当成 id', () => {
    expect(nativeLang('in-ID,en;q=0.5')).toBe('id');
  });

  it('按 q 权重排，权重相同按出现顺序；跳过认不出的', () => {
    expect(nativeLang('en;q=0.5,ja;q=0.9')).toBe('ja');
    expect(nativeLang('ko-KR,de;q=0.8,fr;q=0.8')).toBe('de');
    expect(nativeLang('fr;q=0.1, es')).toBe('es');
    expect(nativeLang('ru;q=abc,ja;q=0.2')).toBe('ja');
  });
});

describe('nativeResult（结果页 HTML）', () => {
  it('按语言出文案和 html lang，带 Vary', async () => {
    const res = nativeResult(`${NATIVE_RETURN}?code=abc`, true, 'de-DE,de;q=0.9');
    expect(res.headers.get('vary')).toBe('accept-language');
    const html = await res.text();
    expect(html).toContain('<html lang="de">');
    expect(html).toContain('Angemeldet.');
    expect(html).toContain('Mindough öffnen');
    expect(html).not.toContain('念头团');
  });

  it('中文仍叫念头团；失败页用失败文案', async () => {
    const html = await nativeResult(`${NATIVE_RETURN}?login_error=access_denied`, false, 'zh-CN').text();
    expect(html).toContain('<html lang="zh-CN">');
    expect(html).toContain('没有登录成功');
    expect(html).toContain('打开念头团');
  });

  it('葡语用 pt-BR', async () => {
    const html = await nativeResult(NATIVE_RETURN, false, 'pt').text();
    expect(html).toContain('<html lang="pt-BR">');
    expect(html).toContain('Não foi possível entrar');
  });
});
