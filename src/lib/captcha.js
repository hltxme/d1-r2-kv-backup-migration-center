/**
 * 图形验证码（SVG，服务端生成，无第三方依赖）
 *
 * 验证码答案不入库、不下发给前端，而是放在 httpOnly Cookie 里并用 HMAC 签名，
 * 因此无需额外存储，且 JS 无法读取答案。
 */
import { randomBytes, hmacBase64, timingSafeEqual } from './crypto.js';

export const CAPTCHA_COOKIE = 'bc_captcha';

const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉易混淆的 0O1Il
const PALETTE = [
  '#4f46e5', '#0ea5e9', '#db2777', '#f59e0b', '#10b981', '#8b5cf6', '#ef4444',
];

function pick(arr) {
  return arr[randomBytes(1)[0] % arr.length];
}

function rand(min, max) {
  return min + (randomBytes(1)[0] % (max - min + 1));
}

/** 生成一个 4-6 位验证码 */
function randomCode(len = 4) {
  let out = '';
  const bytes = randomBytes(len);
  for (let i = 0; i < len; i += 1) out += CHARSET[bytes[i] % CHARSET.length];
  return out;
}

/**
 * 生成验证码 SVG 与待写入的 Cookie 值
 * @returns {{ svg: string, cookiePair: [string,string], code: string }}
 */
export async function createCaptcha(secret, { ttlSeconds = 300, length = 4 } = {}) {
  const code = randomCode(length);
  const exp = Date.now() + Math.max(30, ttlSeconds) * 1000;
  const nonce = randomBytes(6).reduce((s, b) => s + b.toString(16).padStart(2, '0'), '');
  const payload = `${code}|${exp}|${nonce}`;
  const sig = await hmacBase64(secret, payload);
  const cookieValue = `${payload}|${sig}`;

  return {
    code,
    svg: renderCaptchaSvg(code),
    cookieValue,
    exp,
  };
}

/**
 * 校验用户输入的验证码
 * @returns {{ ok: boolean, reason?: string }}
 */
export async function verifyCaptcha(secret, cookieValue, userInput) {
  const input = String(userInput ?? '').trim().toUpperCase();
  if (!input) return { ok: false, reason: 'EMPTY' };
  if (!cookieValue) return { ok: false, reason: 'EXPIRED' };

  const parts = String(cookieValue).split('|');
  if (parts.length !== 4) return { ok: false, reason: 'EXPIRED' };
  const [code, expStr, nonce, sig] = parts;

  const exp = parseInt(expStr, 10);
  if (!Number.isFinite(exp) || exp < Date.now()) return { ok: false, reason: 'EXPIRED' };

  const expect = await hmacBase64(secret, `${code}|${expStr}|${nonce}`);
  if (!timingSafeEqual(expect, sig)) return { ok: false, reason: 'EXPIRED' };
  if (!timingSafeEqual(code, input)) return { ok: false, reason: 'MISMATCH' };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// SVG 渲染
// ---------------------------------------------------------------------------

function renderCaptchaSvg(code) {
  const width = 148;
  const height = 52;
  const chars = code.split('');
  const step = width / (chars.length + 1);

  const noise = [];
  // 干扰曲线
  for (let i = 0; i < 3; i += 1) {
    const y1 = rand(6, height - 6);
    const y2 = rand(6, height - 6);
    const y3 = rand(6, height - 6);
    noise.push(
      `<path d="M0 ${y1} Q ${width / 3} ${y2} ${width} ${y3}" fill="none" stroke="${pick(PALETTE)}" stroke-width="1.2" opacity="0.35"/>`,
    );
  }
  // 干扰点
  for (let i = 0; i < 18; i += 1) {
    noise.push(
      `<circle cx="${rand(2, width - 2)}" cy="${rand(2, height - 2)}" r="${rand(1, 2)}" fill="${pick(PALETTE)}" opacity="0.3"/>`,
    );
  }

  const glyphs = chars
    .map((ch, i) => {
      const x = step * (i + 1);
      const y = height / 2 + rand(-4, 6);
      const rotate = rand(-22, 22);
      const size = rand(26, 31);
      const color = pick(PALETTE);
      return (
        `<text x="${x}" y="${y}" fill="${color}" font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace"` +
        ` font-size="${size}" font-weight="700" text-anchor="middle"` +
        ` transform="rotate(${rotate} ${x} ${y})">${ch}</text>`
      );
    })
    .join('');

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="captcha">` +
    `<rect width="${width}" height="${height}" rx="10" fill="#f8fafc"/>` +
    `<rect width="${width}" height="${height}" rx="10" fill="none" stroke="#e2e8f0" stroke-width="1"/>` +
    noise.join('') +
    glyphs +
    `</svg>`
  );
}

/** 验证码图片的缓存头（禁止缓存） */
export const CAPTCHA_HEADERS = [
  ['cache-control', 'no-store, no-cache, must-revalidate'],
  ['pragma', 'no-cache'],
];
