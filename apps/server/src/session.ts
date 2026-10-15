/**
 * 签名 cookie：base64url(JSON) + "." + base64url(HMAC-SHA256(SESSION_SECRET, payload))。
 * 不存服务端状态；过期时间写在 payload 里（exp，毫秒）。
 */
const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Uint8Array {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function hmacKey(secret: string) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function sign(payload: object, secret: string): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(body)));
  return `${body}.${b64url(sig)}`;
}

/** 验签并检查 exp；任何不对都返回 null。 */
export async function verify<T extends { exp: number }>(token: string | null | undefined, secret: string, now = Date.now()): Promise<T | null> {
  if (!token) return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  try {
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), fromB64url(token.slice(dot + 1)), enc.encode(body));
    if (!ok) return null;
    const data = JSON.parse(new TextDecoder().decode(fromB64url(body))) as T;
    if (typeof data.exp !== 'number' || data.exp < now) return null;
    return data;
  } catch {
    return null;
  }
}

export function randomToken(bytes = 24): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get('cookie') ?? '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export function setCookie(name: string, value: string, opts: { maxAge: number; secure: boolean; path?: string }): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${opts.path ?? '/'}`, `Max-Age=${opts.maxAge}`, 'HttpOnly', 'SameSite=Lax'];
  if (opts.secure) parts.push('Secure');
  return parts.join('; ');
}
