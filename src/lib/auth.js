/**
 * 会话鉴权：Cookie 会话、登录风控、审计
 */
import { sha256Base64, randomToken, hmacBase64, timingSafeEqual } from './crypto.js';
import { one, run, all, count } from './db.js';
import { setCookie, clearCookie, parseCookies, getClientIp, getUserAgent, err } from './http.js';

export const SESSION_COOKIE = 'bc_session';

function sessionTtlMs(env) {
  const days = parseInt(env.SESSION_TTL_DAYS || '7', 10);
  return Math.max(1, Number.isFinite(days) ? days : 7) * 24 * 60 * 60 * 1000;
}

/** 创建会话，返回原始 token（只出现在 Set-Cookie 中，不落库、不进日志） */
export async function createSession(db, env, user, req) {
  const token = randomToken(48);
  const tokenId = await sha256Base64(token);
  const ttl = sessionTtlMs(env);
  const expiresAt = new Date(Date.now() + ttl).toISOString();
  await run(
    db,
    `INSERT INTO sessions (id, user_id, token_hint, ip, user_agent, expires_at, created_at, last_seen)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    [tokenId, user.id, token.slice(0, 8), getClientIp(req), getUserAgent(req), expiresAt],
  );
  await run(db, 'UPDATE users SET last_login_at = datetime(\'now\'), last_login_ip = ? WHERE id = ?', [
    getClientIp(req), user.id,
  ]);
  return { token, expiresAt, maxAge: Math.floor(ttl / 1000) };
}

export async function destroySession(db, req) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  if (!token) return;
  const tokenId = await sha256Base64(token);
  await run(db, 'DELETE FROM sessions WHERE id = ?', [tokenId]);
}

/** 根据请求解析当前登录用户（含过期清理） */
export async function getUserFromRequest(db, req) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  const tokenId = await sha256Base64(token);
  const row = await one(
    db,
    `SELECT u.*, s.id AS session_id, s.expires_at AS session_expires
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = ?`,
    [tokenId],
  );
  if (!row) return null;
  if (new Date(row.session_expires).getTime() < Date.now()) {
    await run(db, 'DELETE FROM sessions WHERE id = ?', [tokenId]);
    return null;
  }
  if (row.status !== 'active') return null;
  await run(db, 'UPDATE sessions SET last_seen = datetime(\'now\') WHERE id = ?', [tokenId]);
  return row;
}

/** 取出未过期会话列表（个人资料页展示） */
export async function listSessions(db, userId) {
  return all(
    db,
    `SELECT id, token_hint, ip, user_agent, expires_at, created_at, last_seen
       FROM sessions WHERE user_id = ? AND expires_at > datetime('now')
      ORDER BY last_seen DESC LIMIT 20`,
    [userId],
  );
}

export async function revokeOtherSessions(db, userId, currentToken) {
  const currentId = await sha256Base64(currentToken);
  await run(db, 'DELETE FROM sessions WHERE user_id = ? AND id <> ?', [userId, currentId]);
}

export function sessionCookiePair(token, maxAge) {
  return setCookie(SESSION_COOKIE, token, {
    maxAge,
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
  });
}

export function sessionClearPair() {
  return clearCookie(SESSION_COOKIE);
}

// ---------------------------------------------------------------------------
// 登录风控
// ---------------------------------------------------------------------------

export async function isLoginBlocked(db, env, username) {
  const max = parseInt(env.LOGIN_MAX_ATTEMPTS || '5', 10);
  const minutes = parseInt(env.LOGIN_LOCK_MINUTES || '10', 10);
  const recent = await count(
    db,
    `SELECT COUNT(*) FROM login_attempts
      WHERE username = ? AND success = 0 AND created_at > datetime('now', ?)`,
    [username, `-${minutes} minutes`],
  );
  return recent >= max ? { blocked: true, retryAfterMinutes: minutes, attempts: recent } : { blocked: false, attempts: recent };
}

export async function recordLoginAttempt(db, username, ip, success) {
  await run(db, 'INSERT INTO login_attempts (username, ip, success) VALUES (?, ?, ?)', [
    username, ip, success ? 1 : 0,
  ]);
  if (success) {
    await run(db, 'DELETE FROM login_attempts WHERE username = ?', [username]);
  }
}

// ---------------------------------------------------------------------------
// 审计
// ---------------------------------------------------------------------------

export async function audit(db, user, action, target = '', detail = '', ip = '') {
  try {
    await run(
      db,
      'INSERT INTO audit_logs (user_id, username, action, target, detail, ip) VALUES (?, ?, ?, ?, ?, ?)',
      [user?.id ?? null, user?.username ?? '', action, target, String(detail ?? '').slice(0, 2000), ip],
    );
  } catch {
    /* 审计失败不影响主流程 */
  }
}

// ---------------------------------------------------------------------------
// 鉴权中间件
// ---------------------------------------------------------------------------

export async function requireUser(db, req) {
  const user = await getUserFromRequest(db, req);
  if (!user) throw err.unauthorized('登录已过期，请重新登录');
  return user;
}

export async function requireAdmin(db, req) {
  const user = await requireUser(db, req);
  if (user.role !== 'admin') throw err.forbidden('需要管理员权限');
  return user;
}

/** 用于验证码/签名串 */
export async function signValue(secret, value) {
  return hmacBase64(secret, value);
}

export async function verifySignature(secret, value, signature) {
  const expect = await hmacBase64(secret, value);
  return timingSafeEqual(expect, signature);
}
