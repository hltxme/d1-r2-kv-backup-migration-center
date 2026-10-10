/**
 * Cloudflare Account REST API 客户端（零依赖）
 * 文档：https://developers.cloudflare.com/api/
 */

const API_BASE = 'https://api.cloudflare.com/client/v4';

export class CloudflareError extends Error {
  constructor(message, { status = 0, errors = [], code = 0 } = {}) {
    super(message);
    this.name = 'CloudflareError';
    this.status = status;
    this.code = code;
    this.errors = errors;
  }
}

export class CloudflareAPI {
  /**
   * @param {{accountId: string, apiToken: string, timeoutMs?: number}} opts
   */
  constructor({ accountId, apiToken, timeoutMs = 30000 }) {
    this.accountId = String(accountId || '').trim();
    this.apiToken = String(apiToken || '').trim();
    this.timeoutMs = timeoutMs;
    if (!this.accountId) throw new CloudflareError('缺少 Account ID');
    if (!this.apiToken) throw new CloudflareError('缺少 API Token');
  }

  get base() {
    return `${API_BASE}/accounts/${encodeURIComponent(this.accountId)}`;
  }

  async request(path, { method = 'GET', query, body, headers = {}, raw = false, baseUrl } = {}) {
    const url = new URL(path.startsWith('http') ? path : `${baseUrl || this.base}${path}`);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('请求 Cloudflare API 超时')), this.timeoutMs);

    let payload;
    if (body instanceof FormData || body instanceof ArrayBuffer || body instanceof Uint8Array) {
      payload = body;
    } else if (body !== undefined && body !== null) {
      payload = JSON.stringify(body);
      headers['content-type'] = 'application/json; charset=utf-8';
    }

    let res;
    try {
      res = await fetch(url.toString(), {
        method,
        headers: {
          authorization: `Bearer ${this.apiToken}`,
          'user-agent': 'd1-r2-kv-backup-migration-center/1.0',
          ...headers,
        },
        body: payload,
        signal: controller.signal,
      });
    } catch (e) {
      throw new CloudflareError(`无法连接 Cloudflare API：${e?.message || e}`);
    } finally {
      clearTimeout(timer);
    }

    if (raw) return res;

    let data = null;
    const text = await res.text();
    try { data = text ? JSON.parse(text) : {}; } catch { data = { success: false, errors: [{ message: text.slice(0, 500) }] }; }

    if (!res.ok || data?.success === false) {
      const first = Array.isArray(data?.errors) && data.errors.length
        ? data.errors[0]
        : { message: `HTTP ${res.status}` };
      throw new CloudflareError(first.message || `HTTP ${res.status}`, {
        status: res.status,
        errors: data?.errors || [],
        code: first.code || 0,
      });
    }
    return data;
  }

  get(path, query, opts = {}) { return this.request(path, { query, ...opts }); }
  post(path, body, opts = {}) { return this.request(path, { method: 'POST', body, ...opts }); }
  put(path, body, opts = {}) { return this.request(path, { method: 'PUT', body, ...opts }); }
  patch(path, body, opts = {}) { return this.request(path, { method: 'PATCH', body, ...opts }); }
  del(path, opts = {}) { return this.request(path, { method: 'DELETE', ...opts }); }

  // -------------------------------------------------------------------------
  // 账号 / Token
  // -------------------------------------------------------------------------

  /** 校验 Token 是否有效 */
  async verifyToken() {
    return this.get(`${API_BASE}/user/tokens/verify`);
  }

  async getAccount() {
    const res = await this.get(`${API_BASE}/accounts/${encodeURIComponent(this.accountId)}`);
    return res.result;
  }

  /** 一次性拉取账号概要 + Token 校验 */
  async probe() {
    const [verify, account] = await Promise.allSettled([this.verifyToken(), this.getAccount()]);
    return {
      tokenValid: verify.status === 'fulfilled' && verify.value?.result?.status === 'active',
      account: account.status === 'fulfilled' ? account.value : null,
      errors: [
        verify.status === 'rejected' ? verify.reason?.message : null,
        account.status === 'rejected' ? account.reason?.message : null,
      ].filter(Boolean),
    };
  }

  // -------------------------------------------------------------------------
  // D1
  // -------------------------------------------------------------------------

  async listD1({ page = 1, perPage = 100 } = {}) {
    return this.get('/d1/database', { page, per_page: perPage });
  }

  async getAllD1(maxPages = 10) {
    const out = [];
    for (let page = 1; page <= maxPages; page += 1) {
      const res = await this.listD1({ page, perPage: 100 });
      const list = res.result || [];
      out.push(...list);
      const info = res.result_info || {};
      if (!list.length || list.length < (info.per_page || 100)) break;
    }
    return out;
  }

  getD1(databaseId) {
    return this.get(`/d1/database/${encodeURIComponent(databaseId)}`);
  }

  createD1(name) {
    return this.post('/d1/database', { name });
  }

  deleteD1(databaseId) {
    return this.del(`/d1/database/${encodeURIComponent(databaseId)}`);
  }

  /** 执行 SQL（D1 HTTP API） */
  async d1Query(databaseId, sql, params = []) {
    const res = await this.post(`/d1/database/${encodeURIComponent(databaseId)}/query`, { sql, params });
    return res.result?.[0] ?? { results: [], meta: {}, success: true };
  }

  /** 分页遍历某张表的全部数据 */
  async d1ScanAll(databaseId, table, { pageSize = 500, maxRows = 200000 } = {}) {
    const rows = [];
    let offset = 0;
    const safeTable = String(table).replace(/[^A-Za-z0-9_]/g, '');
    while (rows.length < maxRows) {
      const page = await this.d1Query(databaseId, `SELECT * FROM "${safeTable}" LIMIT ? OFFSET ?`, [pageSize, offset]);
      const list = page.results || [];
      rows.push(...list);
      if (list.length < pageSize) break;
      offset += pageSize;
    }
    return rows;
  }

  /** 拿到用户表清单 */
  async d1Tables(databaseId) {
    const res = await this.d1Query(
      databaseId,
      `SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name`,
    );
    return res.results || [];
  }

  // -------------------------------------------------------------------------
  // R2（存储桶管理走 Account API，对象级操作走 S3 兼容 API，见 s3.js）
  // -------------------------------------------------------------------------

  async listR2Buckets({ page = 1, perPage = 100 } = {}) {
    return this.get('/r2/buckets', { page, per_page: perPage, direction: 'desc', order: 'name' });
  }

  async getAllR2Buckets(maxPages = 10) {
    const out = [];
    for (let page = 1; page <= maxPages; page += 1) {
      const res = await this.listR2Buckets({ page, perPage: 100 });
      const list = res.result?.buckets || res.result || [];
      out.push(...list);
      if (list.length < 100) break;
    }
    return out;
  }

  getR2Bucket(name) {
    return this.get(`/r2/buckets/${encodeURIComponent(name)}`);
  }

  createR2Bucket(name, location = '') {
    const body = { name };
    if (location) body.location = { name: location };
    return this.post('/r2/buckets', body);
  }

  deleteR2Bucket(name) {
    return this.del(`/r2/buckets/${encodeURIComponent(name)}`);
  }

  // -------------------------------------------------------------------------
  // KV
  // -------------------------------------------------------------------------

  async listKvNamespaces({ page = 1, perPage = 100 } = {}) {
    return this.get('/storage/kv/namespaces', { page, per_page: perPage, order: 'title', direction: 'asc' });
  }

  async getAllKvNamespaces(maxPages = 10) {
    const out = [];
    for (let page = 1; page <= maxPages; page += 1) {
      const res = await this.listKvNamespaces({ page, perPage: 100 });
      const list = res.result || [];
      out.push(...list);
      const info = res.result_info || {};
      if (!list.length || list.length < (info.per_page || 100)) break;
    }
    return out;
  }

  createKvNamespace(title) {
    return this.post('/storage/kv/namespaces', { title });
  }

  updateKvNamespace(nsId, title) {
    return this.put(`/storage/kv/namespaces/${encodeURIComponent(nsId)}`, { title });
  }

  deleteKvNamespace(nsId) {
    return this.del(`/storage/kv/namespaces/${encodeURIComponent(nsId)}`);
  }

  /** 遍历 key 列表（支持 cursor） */
  async listKvKeys(nsId, { prefix = '', limit = 1000, cursor = null } = {}) {
    const query = { limit, prefix };
    if (cursor) query.cursor = cursor;
    return this.get(`/storage/kv/namespaces/${encodeURIComponent(nsId)}/keys`, query);
  }

  async getAllKvKeys(nsId, { prefix = '', maxKeys = 100000 } = {}) {
    const out = [];
    let cursor = null;
    for (let i = 0; i < 200; i += 1) {
      const res = await this.listKvKeys(nsId, { prefix, limit: 1000, cursor });
      const list = res.result || [];
      out.push(...list);
      cursor = res.result_info?.cursor || null;
      if (!cursor || !list.length || out.length >= maxKeys) break;
    }
    return out.slice(0, maxKeys);
  }

  async getKvValue(nsId, key) {
    const res = await this.request(
      `/storage/kv/namespaces/${encodeURIComponent(nsId)}/values/${encodeURIComponent(key)}`,
      { raw: true },
    );
    return res;
  }

  putKvValue(nsId, key, value, { expiration, metadata, base64 = false } = {}) {
    const query = {};
    if (expiration) query.expiration = expiration;
    if (metadata) query.metadata = typeof metadata === 'string' ? metadata : JSON.stringify(metadata);
    if (base64) query.base64 = 'true';
    return this.request(
      `/storage/kv/namespaces/${encodeURIComponent(nsId)}/values/${encodeURIComponent(key)}`,
      { method: 'PUT', body: value, query },
    );
  }

  /** 批量写入（单次上限 10000 条） */
  putKvBulk(nsId, entries) {
    return this.put(`/storage/kv/namespaces/${encodeURIComponent(nsId)}/bulk`, entries);
  }

  deleteKvBulk(nsId, keys) {
    return this.put(`/storage/kv/namespaces/${encodeURIComponent(nsId)}/bulk/delete`, keys);
  }
}
