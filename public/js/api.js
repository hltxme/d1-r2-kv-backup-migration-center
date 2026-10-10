/**
 * API 封装：统一错误处理、登录态跳转、文件下载
 */
import { t } from './i18n.js';

export class ApiError extends Error {
  constructor(message, { status = 0, code = '', payload = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
}

let unauthorizedHandler = null;

/** 401 时的统一回调（由 app.js / login.js 注册） */
export function onUnauthorized(fn) {
  unauthorizedHandler = fn;
}

export async function api(path, { method = 'GET', body, headers = {}, signal } = {}) {
  const opts = {
    method,
    credentials: 'same-origin',
    headers: { accept: 'application/json', ...headers },
    signal,
  };
  if (body !== undefined && body !== null) {
    if (body instanceof FormData) {
      opts.body = body;
    } else {
      opts.headers['content-type'] = 'application/json; charset=utf-8';
      opts.body = JSON.stringify(body);
    }
  }

  let res;
  try {
    res = await fetch(path, opts);
  } catch (e) {
    if (e?.name === 'AbortError') throw e;
    throw new ApiError(t('common.networkError'), { code: 'ERR_NETWORK' });
  }

  let payload = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }

  if (res.status === 401) {
    if (unauthorizedHandler) unauthorizedHandler();
    throw new ApiError(payload?.message || t('login.welcome'), { status: 401, code: 'ERR_UNAUTHORIZED', payload });
  }

  if (!res.ok || payload?.success === false) {
    throw new ApiError(payload?.message || `HTTP ${res.status}`, {
      status: res.status,
      code: payload?.code || '',
      payload,
    });
  }
  return payload?.data ?? payload;
}

export const get = (path) => api(path);
export const post = (path, body) => api(path, { method: 'POST', body });
export const put = (path, body) => api(path, { method: 'PUT', body });
export const del = (path, body) => api(path, { method: 'DELETE', body });

/** 触发浏览器下载（带 Cookie 鉴权） */
export async function download(path, filename) {
  const res = await fetch(path, { credentials: 'same-origin' });
  if (res.status === 401) {
    if (unauthorizedHandler) unauthorizedHandler();
    throw new ApiError('Unauthorized', { status: 401, code: 'ERR_UNAUTHORIZED' });
  }
  if (!res.ok) throw new ApiError(`下载失败 HTTP ${res.status}`, { status: res.status });

  const blob = await res.blob();
  let name = filename;
  if (!name) {
    const cd = res.headers.get('content-disposition') || '';
    const m = cd.match(/filename\*=UTF-8''([^;]+)/i) || cd.match(/filename="?([^";]+)"?/i);
    if (m) name = decodeURIComponent(m[1]);
  }
  name = name || 'download.bin';

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
  return name;
}

/** 把文件读成 JSON 对象 */
export function readFileAsJson(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try { resolve(JSON.parse(String(reader.result))); } catch (e) { reject(new Error('JSON 解析失败')); }
    };
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsText(file);
  });
}
