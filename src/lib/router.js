/**
 * 极简路由器（支持 :param 路径参数）
 */
import { err, fail, ok } from './http.js';

function match(pattern, path) {
  const pSeg = pattern.split('/').filter(Boolean);
  const uSeg = path.split('/').filter(Boolean);
  if (pSeg.length !== uSeg.length) return null;
  const params = {};
  for (let i = 0; i < pSeg.length; i += 1) {
    const p = pSeg[i];
    if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(uSeg[i]);
    else if (p !== uSeg[i]) return null;
  }
  return params;
}

export class Router {
  constructor() {
    this.routes = [];
  }

  add(method, pattern, handler) {
    this.routes.push({ method: method.toUpperCase(), pattern, handler });
    return this;
  }

  get(p, h) { return this.add('GET', p, h); }
  post(p, h) { return this.add('POST', p, h); }
  put(p, h) { return this.add('PUT', p, h); }
  patch(p, h) { return this.add('PATCH', p, h); }
  del(p, h) { return this.add('DELETE', p, h); }
  delete(p, h) { return this.add('DELETE', p, h); }

  async dispatch(req, env, ctx) {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = req.method.toUpperCase();

    // CORS 预检
    if (method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
          'access-control-allow-headers': 'content-type,authorization,x-requested-with',
          'access-control-max-age': '86400',
        },
      });
    }

    for (const route of this.routes) {
      if (route.method !== method) continue;
      const params = match(route.pattern, path);
      if (!params) continue;
      try {
        const result = await route.handler({ req, env, ctx, params, url, query: Object.fromEntries(url.searchParams.entries()) });
        if (result instanceof Response) return result;
        return ok(result ?? null);
      } catch (e) {
        if (e?.code === 'ERR_INTERNAL' || !(e && e.status)) {
          console.error(`[api] ${method} ${path}`, e);
        }
        return fail(e);
      }
    }

    return fail(err.notFound(`接口不存在：${method} ${path}`));
  }
}
