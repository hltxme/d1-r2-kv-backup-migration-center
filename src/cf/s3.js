/**
 * R2 S3 兼容 API 客户端（AWS Signature V4 签名，零依赖）
 *
 * Cloudflare R2 的「存储桶管理」走 Account REST API（见 client.js），
 * 但「对象级读写/列举」只能走 S3 兼容 API，需要 R2 Access Key ID + Secret。
 * 文档：https://developers.cloudflare.com/r2/api/s3-api/
 */

const textEncoder = new TextEncoder();

// ---------------------------------------------------------------------------
// SigV4 工具
// ---------------------------------------------------------------------------

function uriEncode(str, encodeSlash = true) {
  const bytes = textEncoder.encode(String(str ?? ''));
  let out = '';
  for (const b of bytes) {
    const ch = String.fromCharCode(b);
    if (/[A-Za-z0-9\-._~]/.test(ch)) out += ch;
    else if (ch === '/' && !encodeSlash) out += '/';
    else out += `%${b.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return out;
}

function toHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256HexBytes(data) {
  const buf = typeof data === 'string' ? textEncoder.encode(data) : data;
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return toHex(new Uint8Array(digest));
}

async function hmacRaw(key, data) {
  const k = typeof key === 'string' ? textEncoder.encode(key) : key;
  const cryptoKey = await crypto.subtle.importKey('raw', k, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, textEncoder.encode(data));
  return new Uint8Array(sig);
}

function amzDate(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function dateStamp(ts) {
  return ts.slice(0, 8);
}

/**
 * 生成 SigV4 授权头
 * @returns {{headers: Record<string,string>, canonicalRequest: string}}
 */
async function signV4({ method, host, path, query = {}, headers = {}, body, accessKeyId, secretAccessKey, region, service = 's3', date = new Date() }) {
  const ts = amzDate(date);
  const dStamp = dateStamp(ts);

  // 1. 规范查询串
  const queryEntries = Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => [uriEncode(k, true), uriEncode(v, true)])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1));
  const canonicalQuery = queryEntries.map(([k, v]) => `${k}=${v}`).join('&');

  // 2. 载荷哈希
  const payloadHash = body === undefined || body === null
    ? await sha256HexBytes('')
    : body === 'UNSIGNED-PAYLOAD'
      ? 'UNSIGNED-PAYLOAD'
      : await sha256HexBytes(body);

  // 3. 规范请求头
  const allHeaders = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': ts,
    ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).trim()])),
  };
  const headerKeys = Object.keys(allHeaders).sort();
  const canonicalHeaders = headerKeys.map((k) => `${k}:${allHeaders[k].replace(/\s+/g, ' ')}\n`).join('');
  const signedHeaders = headerKeys.join(';');

  const canonicalUri = path || '/';
  const canonicalRequest = [
    method.toUpperCase(),
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  // 4. 签名
  const scope = `${dStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', ts, scope, await sha256HexBytes(canonicalRequest)].join('\n');

  let key = await hmacRaw(`AWS4${secretAccessKey}`, dStamp);
  key = await hmacRaw(key, region);
  key = await hmacRaw(key, service);
  key = await hmacRaw(key, 'aws4_request');
  const signature = toHex(await hmacRaw(key, stringToSign));

  allHeaders.authorization =
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return { headers: allHeaders, canonicalRequest, payloadHash };
}

// ---------------------------------------------------------------------------
// R2S3
// ---------------------------------------------------------------------------

export class R2Error extends Error {
  constructor(message, { status = 0, code = '' } = {}) {
    super(message);
    this.name = 'R2Error';
    this.status = status;
    this.code = code;
  }
}

export class R2S3 {
  /**
   * @param {{accountId:string, accessKeyId:string, secretAccessKey:string, endpoint?:string, timeoutMs?:number}} opts
   */
  constructor({ accountId, accessKeyId, secretAccessKey, endpoint, timeoutMs = 60000 }) {
    this.accountId = String(accountId || '').trim();
    this.accessKeyId = String(accessKeyId || '').trim();
    this.secretAccessKey = String(secretAccessKey || '').trim();
    this.region = 'auto';
    this.timeoutMs = timeoutMs;

    if (!this.accessKeyId || !this.secretAccessKey) {
      throw new R2Error('该 CF 账号尚未配置 R2 Access Key / Secret（在「CF帐号管理 → 编辑」中填写）', { code: 'NO_R2_KEY' });
    }
    const base = String(endpoint || '').trim() || `https://${this.accountId}.r2.cloudflarestorage.com`;
    this.host = new URL(base).host;
    this.protocol = new URL(base).protocol;
  }

  get endpoint() {
    return `${this.protocol}//${this.host}`;
  }

  /** 发起一次带签名的 S3 请求 */
  async send(method, bucket, key = '', { query = {}, headers = {}, body, unsigned = false, raw = false } = {}) {
    const rawPath = `/${[bucket, ...String(key || '').split('/').filter(Boolean)].join('/')}`;
    const encodedPath = uriEncode(rawPath, false);
    const signed = await signV4({
      method,
      host: this.host,
      path: encodedPath,
      query,
      headers,
      body: unsigned ? 'UNSIGNED-PAYLOAD' : body,
      accessKeyId: this.accessKeyId,
      secretAccessKey: this.secretAccessKey,
      region: this.region,
    });

    const finalUrl = `${this.endpoint}${encodedPath}${buildQuery(query)}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('R2 请求超时')), this.timeoutMs);
    let res;
    try {
      res = await fetch(finalUrl, {
        method,
        headers: signed.headers,
        body: body === undefined || body === null ? undefined : body,
        signal: controller.signal,
      });
    } catch (e) {
      throw new R2Error(`无法连接 R2 S3 端点：${e?.message || e}`);
    } finally {
      clearTimeout(timer);
    }

    if (raw) return res;

    const text = await res.text();
    if (!res.ok) {
      throw new R2Error(extractS3Error(text) || `S3 请求失败 HTTP ${res.status}`, {
        status: res.status,
        code: extractS3ErrorCode(text),
      });
    }
    return text;
  }

  // -------------------------------------------------------------------------
  // 对象操作
  // -------------------------------------------------------------------------

  async listObjectsV2(bucket, { prefix = '', maxKeys = 1000, continuationToken = null } = {}) {
    const query = { 'list-type': '2', 'max-keys': String(maxKeys) };
    if (prefix) query.prefix = prefix;
    if (continuationToken) query['continuation-token'] = continuationToken;
    const xml = await this.send('GET', bucket, '', { query });
    return parseListObjectsV2(xml);
  }

  /** 遍历全部对象 key */
  async listAllObjects(bucket, { prefix = '', maxKeys = 200000 } = {}) {
    const out = [];
    let token = null;
    for (let i = 0; i < 500; i += 1) {
      const page = await this.listObjectsV2(bucket, { prefix, maxKeys: 1000, continuationToken: token });
      out.push(...page.contents);
      token = page.isTruncated ? page.nextContinuationToken : null;
      if (!token || out.length >= maxKeys) break;
    }
    return out.slice(0, maxKeys);
  }

  /** 读取对象，返回 Response（可直接 stream 到目标桶） */
  async getObjectResponse(bucket, key) {
    return this.send('GET', bucket, key, { raw: true });
  }

  async putObject(bucket, key, body, { contentType = 'application/octet-stream', metadata, cacheControl, contentEncoding } = {}) {
    const headers = { 'content-type': contentType };
    if (cacheControl) headers['cache-control'] = cacheControl;
    if (contentEncoding) headers['content-encoding'] = contentEncoding;
    if (metadata) {
      for (const [k, v] of Object.entries(metadata)) {
        headers[`x-amz-meta-${k.toLowerCase()}`] = String(v);
      }
    }
    const isStream = typeof body?.getReader === 'function';
    return this.send('PUT', bucket, key, {
      headers,
      body,
      unsigned: isStream,
    });
  }

  async deleteObject(bucket, key) {
    return this.send('DELETE', bucket, key, {});
  }

  async headObject(bucket, key) {
    return this.send('HEAD', bucket, key, { raw: true });
  }
}

// ---------------------------------------------------------------------------
// 解析工具
// ---------------------------------------------------------------------------

function buildQuery(query) {
  const entries = Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '');
  if (!entries.length) return '';
  return `?${entries.map(([k, v]) => `${uriEncode(k, true)}=${uriEncode(v, true)}`).join('&')}`;
}

function decodeXml(str = '') {
  return String(str)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

function tagValue(block, tag) {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return m ? decodeXml(m[1]) : '';
}

export function parseListObjectsV2(xml) {
  const contents = [];
  const re = /<Contents>([\s\S]*?)<\/Contents>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const block = m[1];
    contents.push({
      key: tagValue(block, 'Key'),
      size: Number(tagValue(block, 'Size') || 0),
      lastModified: tagValue(block, 'LastModified'),
      etag: tagValue(block, 'ETag').replace(/"/g, ''),
      storageClass: tagValue(block, 'StorageClass') || 'STANDARD',
    });
  }
  return {
    name: tagValue(xml, 'Name'),
    prefix: tagValue(xml, 'Prefix'),
    keyCount: Number(tagValue(xml, 'KeyCount') || contents.length),
    maxKeys: Number(tagValue(xml, 'MaxKeys') || 1000),
    isTruncated: tagValue(xml, 'IsTruncated') === 'true',
    nextContinuationToken: tagValue(xml, 'NextContinuationToken'),
    contents,
  };
}

function extractS3Error(xml = '') {
  const msg = tagValue(xml, 'Message');
  if (msg) return msg;
  const code = tagValue(xml, 'Code');
  return code ? `S3 错误：${code}` : '';
}

function extractS3ErrorCode(xml = '') {
  return tagValue(xml, 'Code');
}
