/**
 * HTTP 基础工具：统一响应结构、Cookie、请求解析
 *
 * 所有业务接口返回格式：
 *   成功 { success: true,  data: ..., message: "..." }
 *   失败 { success: false, code: "ERR_XXX", message: "..." }
 */

export class ApiError extends Error {
  constructor(message, status = 400, code = 'ERR_BAD_REQUEST', extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export const err = {
  badRequest: (m, extra) => new ApiError(m, 400, 'ERR_BAD_REQUEST', extra),
  unauthorized: (m = '未登录或会话已过期', extra) => new ApiError(m, 401, 'ERR_UNAUTHORIZED', extra),
  forbidden: (m = '没有权限执行该操作', extra) => new ApiError(m, 403, 'ERR_FORBIDDEN', extra),
  notFound: (m = '资源不存在', extra) => new ApiError(m, 404, 'ERR_NOT_FOUND', extra),
  conflict: (m, extra) => new ApiError(m, 409, 'ERR_CONFLICT', extra),
  tooMany: (m, extra) => new ApiError(m, 429, 'ERR_TOO_MANY', extra),
  upstream: (m, extra) => new ApiError(m, 502, 'ERR_UPSTREAM', extra),
  internal: (m = '服务器内部错误', extra) => new ApiError(m, 500, 'ERR_INTERNAL', extra),
};

/** 成功响应 */
export function ok(data = null, message = '', extra = {}) {
  return json({ success: true, data, message, ...extra });
}

/** 失败响应 */
export function fail(e) {
  const isApi = e instanceof ApiError;
  const isUpstream = !isApi && (e?.name === 'CloudflareError' || e?.name === 'R2Error');
  if (isUpstream) {
    return json({ success: false, code: 'ERR_UPSTREAM', message: `调用 Cloudflare API 失败：${e.message}` }, 502);
  }
  const status = isApi ? e.status : 500;
  const code = isApi ? e.code : 'ERR_INTERNAL';
  const message = isApi ? e.message : (e?.message || '服务器内部错误');
  return json({ success: false, code, message, ...(isApi ? e.extra : {}) }, status);
}

export function json(payload, status = 200, headerPairs = []) {
  const headers = new Headers(headerPairs);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('referrer-policy', 'same-origin');
  return new Response(JSON.stringify(payload), { status, headers });
}

/** 原始响应（下载文件等） */
export function raw(body, { status = 200, type = 'application/octet-stream', filename, headerPairs = [] } = {}) {
  const headers = new Headers(headerPairs);
  headers.set('content-type', type);
  if (filename) {
    headers.set('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  }
  return new Response(body, { status, headers });
}

// ---------------------------------------------------------------------------
// Cookie
// ---------------------------------------------------------------------------

export function parseCookies(req) {
  const out = {};
  const header = req.headers.get('cookie');
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (!k) continue;
    try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
  }
  return out;
}

/**
 * 生成 Set-Cookie 头。默认 httpOnly + sameSite=Lax + path=/
 * @returns {Array<[string,string]>} 可直接塞进 headerPairs
 */
export function setCookie(name, value, opts = {}) {
  const {
    maxAge = 60 * 60 * 24 * 7,
    path = '/',
    httpOnly = true,
    secure = true,
    sameSite = 'Lax',
    expires,
  } = opts;
  let str = `${name}=${encodeURIComponent(value)}`;
  if (expires) str += `; Expires=${expires}`;
  else if (maxAge !== null) str += `; Max-Age=${maxAge}`;
  str += `; Path=${path}`;
  if (httpOnly) str += '; HttpOnly';
  if (secure) str += '; Secure';
  if (sameSite) str += `; SameSite=${sameSite}`;
  return ['set-cookie', str];
}

export function clearCookie(name) {
  return setCookie(name, '', { maxAge: 0 });
}

// ---------------------------------------------------------------------------
// 请求解析
// ---------------------------------------------------------------------------

export function getQuery(req) {
  return Object.fromEntries(new URL(req.url).searchParams.entries());
}

export async function readJson(req, { optional = false } = {}) {
  const ct = req.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    if (optional) return {};
    throw err.badRequest('请求体必须是 JSON');
  }
  try {
    const data = await req.json();
    return data && typeof data === 'object' ? data : {};
  } catch {
    if (optional) return {};
    throw err.badRequest('JSON 解析失败');
  }
}

export function getClientIp(req) {
  return (
    req.headers.get('cf-connecting-ip') ||
    req.headers.get('x-real-ip') ||
    (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() ||
    ''
  );
}

export function getUserAgent(req) {
  return (req.headers.get('user-agent') || '').slice(0, 300);
}

// ---------------------------------------------------------------------------
// 分页
// ---------------------------------------------------------------------------

export function paginate(searchParams, { defaultSize = 15, maxSize = 200 } = {}) {
  let page = parseInt(searchParams.get('page') || '1', 10);
  let pageSize = parseInt(searchParams.get('pageSize') || String(defaultSize), 10);
  if (!Number.isFinite(page) || page < 1) page = 1;
  if (!Number.isFinite(pageSize) || pageSize < 1) pageSize = defaultSize;
  if (pageSize > maxSize) pageSize = maxSize;
  return { page, pageSize, offset: (page - 1) * pageSize, limit: pageSize };
}

export function pageResult(list, total, { page, pageSize }) {
  return {
    list,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
  };
}

// ---------------------------------------------------------------------------
// 校验小工具
// ---------------------------------------------------------------------------

export function requireString(value, field, { min = 1, max = 200 } = {}) {
  const v = typeof value === 'string' ? value.trim() : '';
  if (v.length < min) throw err.badRequest(`${field} 不能为空（至少 ${min} 个字符）`);
  if (v.length > max) throw err.badRequest(`${field} 不能超过 ${max} 个字符`);
  return v;
}

export function optionalString(value, { max = 2000 } = {}) {
  const v = typeof value === 'string' ? value.trim() : '';
  return v.length > max ? v.slice(0, max) : v;
}

export function toInt(value, def = 0) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : def;
}

export function requireIds(body, field = 'ids') {
  const ids = Array.isArray(body?.[field]) ? body[field].map((n) => toInt(n, 0)).filter(Boolean) : [];
  if (!ids.length) throw err.badRequest('请至少选择一条记录');
  return [...new Set(ids)];
}
