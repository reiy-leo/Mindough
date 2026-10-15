/**
 * Mindough Worker 占位。M0 不部署；M1 起加 Google OAuth、静态资源、/api。
 */
export interface Env {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  SESSION_SECRET?: string;
  ADMIN_EMAILS?: string;
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

export default {
  async fetch(request: Request, _env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/health') return json({ ok: true, name: 'mindough', stage: 'M0 占位' });
    return json({ error: '404 未找到：Mindough 服务端尚未上线' }, 404);
  },
} satisfies ExportedHandler<Env>;
