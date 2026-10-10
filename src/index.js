/**
 * Cloudflare Worker 入口
 *
 * 路由分工：
 *   /api/*        → 业务接口（本文件）
 *   /login /app   → 重定向到对应前端页面
 *   /health       → 健康检查
 *   其余          → public/ 静态资源（由 Workers Static Assets 直出）
 */
import { Router } from './lib/router.js';
import { json, raw } from './lib/http.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerAccountRoutes } from './routes/accounts.js';
import { registerResourceRoutes } from './routes/resources.js';
import { registerBackupRoutes } from './routes/backup.js';
import { registerDashboardRoutes } from './routes/dashboard.js';
import { ensureBootstrap } from './seed.js';

const router = new Router();
registerAuthRoutes(router);
registerAccountRoutes(router);
registerResourceRoutes(router);
registerBackupRoutes(router);
registerDashboardRoutes(router);

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'SAMEORIGIN',
  'referrer-policy': 'same-origin',
  'permissions-policy': 'geolocation=(), microphone=(), camera=()',
};

function withSecurityHeaders(res) {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    // ── 业务接口 ──────────────────────────────────────────────────────────
    if (path.startsWith('/api/')) {
      try {
        await ensureBootstrap(env.DB, env);
      } catch (e) {
        console.error('[bootstrap] 初始化失败', e);
      }
      return router.dispatch(req, env, ctx);
    }

    // ── 健康检查 ──────────────────────────────────────────────────────────
    if (path === '/health') {
      return json({
        ok: true,
        name: env.APP_NAME || 'Backup Center',
        version: env.APP_VERSION || '1.0.0',
        time: new Date().toISOString(),
      });
    }

    // ── 便捷短链 ──────────────────────────────────────────────────────────
    if (path === '/login') return Response.redirect(`${url.origin}/index.html`, 302);
    if (path === '/app') return Response.redirect(`${url.origin}/app.html`, 302);

    // ── 站点首页（静态资源 html_handling=none，此处显式映射）──────────────
    if (path === '/' && env.ASSETS) {
      const indexReq = new Request(new URL('/index.html', url.origin), { method: 'GET', headers: req.headers });
      return withSecurityHeaders(await env.ASSETS.fetch(indexReq));
    }

    // ── 静态资源 ──────────────────────────────────────────────────────────
    if (!env.ASSETS) {
      return raw('静态资源未挂载，请检查 wrangler.jsonc 的 assets 配置', {
        status: 500,
        type: 'text/plain; charset=utf-8',
      });
    }
    const res = await env.ASSETS.fetch(req);
    return withSecurityHeaders(res);
  },
};
