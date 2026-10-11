/**
 * 加密工具：密码哈希（PBKDF2）、密钥派生、AES-GCM 加密存储、随机令牌
 * 全部基于 Web Crypto（Workers 原生支持），不依赖任何 npm 包。
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

// ---------------------------------------------------------------------------
// Base64
// ---------------------------------------------------------------------------

export function bytesToBase64(bytes) {
  let s = '';
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i += 1) {
    s += String.fromCharCode(arr[i]);
  }
  return btoa(s);
}

export function base64ToBytes(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i);
  return out;
}

export function utf8ToBase64(str) {
  return bytesToBase64(enc.encode(str));
}

export function base64ToUtf8(b64) {
  return dec.decode(base64ToBytes(b64));
}

// ---------------------------------------------------------------------------
// 随机数 / 摘要
// ---------------------------------------------------------------------------

export function randomBytes(len = 32) {
  const buf = new Uint8Array(len);
  crypto.getRandomValues(buf);
  return buf;
}

/** URL/Token 安全的随机字符串 */
export function randomToken(len = 32) {
  return bytesToBase64(randomBytes(len)).replace(/[+/=]/g, '').slice(0, len);
}

export function randomHex(len = 16) {
  const b = randomBytes(len);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export async function sha256Base64(input) {
  const data = typeof input === 'string' ? enc.encode(input) : input;
  const digest = await crypto.subtle.digest('SHA-256', data);
  return bytesToBase64(new Uint8Array(digest));
}

export async function sha256Hex(input) {
  const data = typeof input === 'string' ? enc.encode(input) : input;
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (x) => x.toString(16).padStart(2, '0')).join('');
}

export async function hmacBase64(secret, data) {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return bytesToBase64(new Uint8Array(sig));
}

/** 常量时间比较，防止时序攻击 */
export function timingSafeEqual(a, b) {
  const sa = String(a ?? '');
  const sb = String(b ?? '');
  if (sa.length !== sb.length) return false;
  let diff = 0;
  for (let i = 0; i < sa.length; i += 1) diff |= sa.charCodeAt(i) ^ sb.charCodeAt(i);
  return diff === 0;
}

// ---------------------------------------------------------------------------
// 密码哈希：pbkdf2$iterations$salt$hash
// ---------------------------------------------------------------------------

const PBKDF2_ALGO = 'PBKDF2-SHA256';

async function pbkdf2(password, saltBytes, iterations, length = 32) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

/**
 * 生成密码哈希串。
 * ⚠️ 默认值请保持在 Workers 免费版 CPU 上限之内（每请求 10ms）：
 *    120000 次 ≈ 19ms 会触发 Error 1102；10000 次 ≈ 1.6ms 安全。
 *    生产中请显式传入 env.PBKDF2_ITERATIONS，不要依赖这个默认值。
 */
export async function hashPassword(password, iterations = 10000) {
  const salt = randomBytes(16);
  const hash = await pbkdf2(password, salt, iterations);
  return `pbkdf2$${iterations}$${bytesToBase64(salt)}$${bytesToBase64(hash)}`;
}

/** 校验密码，传入 hashPassword 生成的串 */
export async function verifyPassword(password, stored) {
  try {
    const parts = String(stored || '').split('$');
    if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
    const iterations = parseInt(parts[1], 10);
    if (!Number.isFinite(iterations) || iterations < 1000 || iterations > 5_000_000) return false;
    const salt = base64ToBytes(parts[2]);
    const expect = parts[3];
    const actual = bytesToBase64(await pbkdf2(password, salt, iterations));
    return timingSafeEqual(actual, expect);
  } catch {
    return false;
  }
}

/** 从旧密码串里取迭代次数，用于平滑升级成本参数 */
export function passwordIterations(stored) {
  const n = parseInt(String(stored || '').split('$')[1], 10);
  return Number.isFinite(n) ? n : 120000;
}

// ---------------------------------------------------------------------------
// 对称加密（AES-GCM）：用于 CF API Token 等敏感字段落库
// ---------------------------------------------------------------------------

const ENC_SALT = enc.encode('d1-r2-kv-backup-migration-center::aes-gcm::v1');

/**
 * ⚠️ 派生 AES-GCM 密钥的 PBKDF2 迭代次数。
 *
 * 这里必须配合 Cloudflare Workers 的 CPU 上限来取值：
 *   60000 次 ≈ 9.4ms CPU，紧贴免费版「每请求 10ms」的上限，
 *   添加 CF 账号（加密 API Token）时极易触发 Error 1102「Worker exceeded resource limits」。
 *   8000 次 ≈ 1.3ms，安全。
 *
 * 注意：修改本值会使旧的 v1.* 密文无法解密（CF API Token 等），
 *       迁移前请先在旧版本上解密备份，或重新录入账号。
 */
const KEY_DERIVE_ITERATIONS = 8000;

let cachedKey = null;

async function deriveKey(secret) {
  if (cachedKey && cachedKey.secret === secret) return cachedKey.key;
  const material = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: ENC_SALT, iterations: KEY_DERIVE_ITERATIONS },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  cachedKey = { secret, key };
  return key;
}

/** 返回 v1.<iv>.<cipher> 格式串 */
export async function encryptSecret(plaintext, secret) {
  const key = await deriveKey(secret);
  const iv = randomBytes(12);
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(String(plaintext ?? '')));
  return `v1.${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(cipher))}`;
}

export async function decryptSecret(payload, secret) {
  const rawStr = String(payload ?? '');
  if (!rawStr) return '';
  if (!rawStr.startsWith('v1.')) {
    // 兼容历史明文（未加密时直接返回，便于平滑迁移）
    return rawStr;
  }
  const [, ivB64, cipherB64] = rawStr.split('.');
  const key = await deriveKey(secret);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(ivB64) },
    key,
    base64ToBytes(cipherB64),
  );
  return dec.decode(plain);
}

/** 生成一个随机的 APP_SECRET 建议值 */
export function generateAppSecret() {
  return randomHex(32);
}
