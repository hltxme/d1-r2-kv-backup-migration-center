/**
 * 鉴权相关接口：验证码、登录/登出、个人资料、密码修改
 */
import {
  ok, err, readJson, getClientIp, requireString, optionalString,
  setCookie, clearCookie, parseCookies,
} from '../lib/http.js';
import { hashPassword, verifyPassword, passwordIterations, sha256Base64 } from '../lib/crypto.js';
import { one, run, getAppSecret } from '../lib/db.js';
import {
  createSession, destroySession, getUserFromRequest, requireUser,
  sessionCookiePair, sessionClearPair, listSessions, revokeOtherSessions,
  isLoginBlocked, recordLoginAttempt, audit,
} from '../lib/auth.js';
import { createCaptcha, verifyCaptcha, CAPTCHA_COOKIE, CAPTCHA_HEADERS } from '../lib/captcha.js';

function userDto(u) {
  return {
    id: u.id,
    username: u.username,
    displayName: u.display_name || u.username,
    email: u.email || '',
    avatar: u.avatar || '',
    bio: u.bio || '',
    locale: u.locale || 'zh-CN',
    theme: u.theme || 'light',
    accent: u.accent || 'indigo',
    role: u.role,
    status: u.status,
    mustChangePwd: Boolean(u.must_change_pwd),
    lastLoginAt: u.last_login_at || '',
    lastLoginIp: u.last_login_ip || '',
    createdAt: u.created_at,
    updatedAt: u.updated_at,
  };
}

export { userDto };

export function registerAuthRoutes(r) {
  // ── 图形验证码 ──────────────────────────────────────────────────────────
  r.get('/api/auth/captcha', async ({ env }) => {
    const db = env.DB;
    const secret = await getAppSecret(db, env);
    const ttl = parseInt(env.CAPTCHA_TTL_SECONDS || '300', 10);
    const cap = await createCaptcha(secret, { ttlSeconds: ttl, length: 4 });
    return new Response(cap.svg, {
      headers: new Headers([
        ['content-type', 'image/svg+xml; charset=utf-8'],
        ...CAPTCHA_HEADERS,
        setCookie(CAPTCHA_COOKIE, cap.cookieValue, {
          maxAge: ttl,
          httpOnly: true,
          secure: true,
          sameSite: 'Lax',
          path: '/',
        }),
      ]),
    });
  });

  // ── 登录 ────────────────────────────────────────────────────────────────
  r.post('/api/auth/login', async ({ req, env }) => {
    const db = env.DB;
    const body = await readJson(req);
    const username = requireString(body.username, '用户名', { min: 1, max: 64 });
    const password = String(body.password ?? '');
    const captcha = String(body.captcha ?? '').trim();

    if (!password) throw err.badRequest('请输入密码');

    const secret = await getAppSecret(db, env);
    const cookies = parseCookies(req);
    const check = await verifyCaptcha(secret, cookies[CAPTCHA_COOKIE], captcha);
    if (!check.ok) {
      const msg = check.reason === 'EXPIRED' ? '验证码已过期，请刷新验证码' : '验证码错误';
      return new Response(
        JSON.stringify({ success: false, code: 'ERR_CAPTCHA', message: msg }),
        { status: 400, headers: [['content-type', 'application/json; charset=utf-8'], clearCookie(CAPTCHA_COOKIE)] },
      );
    }

    const ip = getClientIp(req);
    const blocked = await isLoginBlocked(db, env, username);
    if (blocked.blocked) {
      await recordLoginAttempt(db, username, ip, false);
      throw err.tooMany(`登录失败次数过多，请 ${blocked.retryAfterMinutes} 分钟后再试`);
    }

    const user = await one(db, 'SELECT * FROM users WHERE username = ?', [username]);
    const valid = user && user.status === 'active'
      ? await verifyPassword(password, user.password_hash)
      : false;

    if (!valid) {
      await recordLoginAttempt(db, username, ip, false);
      await audit(db, null, 'auth.login.failed', username, '密码错误或用户不存在', ip);
      throw err.unauthorized('用户名或密码错误');
    }

    await recordLoginAttempt(db, username, ip, true);
    const session = await createSession(db, env, user, req);
    await audit(db, user, 'auth.login', username, '登录成功', ip);

    return new Response(
      JSON.stringify({ success: true, data: { user: userDto(user) }, message: '登录成功' }),
      {
        status: 200,
        headers: new Headers([
          ['content-type', 'application/json; charset=utf-8'],
          sessionCookiePair(session.token, session.maxAge),
          clearCookie(CAPTCHA_COOKIE),
        ]),
      },
    );
  });

  // ── 登出 ────────────────────────────────────────────────────────────────
  r.post('/api/auth/logout', async ({ req, env }) => {
    const db = env.DB;
    const user = await getUserFromRequest(db, req);
    await destroySession(db, req);
    if (user) await audit(db, user, 'auth.logout', user.username, '退出登录', getClientIp(req));
    return new Response(
      JSON.stringify({ success: true, data: null, message: '已退出登录' }),
      { status: 200, headers: new Headers([['content-type', 'application/json; charset=utf-8'], sessionClearPair()]) },
    );
  });

  // ── 当前登录用户 ────────────────────────────────────────────────────────
  r.get('/api/auth/me', async ({ req, env }) => {
    const user = await requireUser(env.DB, req);
    return ok({ user: userDto(user) });
  });

  // ── 修改个人资料 ────────────────────────────────────────────────────────
  r.put('/api/auth/profile', async ({ req, env }) => {
    const db = env.DB;
    const me = await requireUser(db, req);
    const body = await readJson(req);

    const displayName = optionalString(body.displayName, { max: 64 });
    const email = optionalString(body.email, { max: 128 });
    const bio = optionalString(body.bio, { max: 500 });
    const avatar = optionalString(body.avatar, { max: 2048 });
    const locale = ['zh-CN', 'en'].includes(body.locale) ? body.locale : me.locale;
    const theme = optionalString(body.theme, { max: 32 }) || me.theme;
    const accent = optionalString(body.accent, { max: 32 }) || me.accent;

    let username = me.username;
    if (body.username !== undefined && String(body.username).trim() !== me.username) {
      username = requireString(body.username, '用户名', { min: 2, max: 32 });
      if (!/^[A-Za-z0-9_.-]+$/.test(username)) throw err.badRequest('用户名只能包含字母、数字、下划线、点和短横线');
      const dup = await one(db, 'SELECT id FROM users WHERE username = ? AND id <> ?', [username, me.id]);
      if (dup) throw err.conflict('该用户名已被占用');
    }

    await run(
      db,
      `UPDATE users SET username = ?, display_name = ?, email = ?, bio = ?, avatar = ?,
              locale = ?, theme = ?, accent = ?, updated_at = datetime('now')
        WHERE id = ?`,
      [username, displayName, email, bio, avatar, locale, theme, accent, me.id],
    );

    await audit(db, me, 'user.profile.update', username, '更新个人资料', getClientIp(req));
    const fresh = await one(db, 'SELECT * FROM users WHERE id = ?', [me.id]);
    return ok({ user: userDto(fresh) }, '资料已保存');
  });

  // ── 修改密码 ────────────────────────────────────────────────────────────
  r.post('/api/auth/password', async ({ req, env }) => {
    const db = env.DB;
    const me = await requireUser(db, req);
    const body = await readJson(req);

    const oldPassword = String(body.oldPassword ?? '');
    const newPassword = String(body.newPassword ?? '');
    const confirmPassword = String(body.confirmPassword ?? '');

    if (!oldPassword) throw err.badRequest('请输入当前密码');
    if (newPassword.length < 6) throw err.badRequest('新密码至少 6 位');
    if (newPassword.length > 72) throw err.badRequest('新密码不能超过 72 位');
    if (newPassword !== confirmPassword) throw err.badRequest('两次输入的新密码不一致');
    if (newPassword === oldPassword) throw err.badRequest('新密码不能与当前密码相同');

    const okOld = await verifyPassword(oldPassword, me.password_hash);
    if (!okOld) throw err.badRequest('当前密码不正确');

    const iterations = Math.max(120000, passwordIterations(me.password_hash));
    const hash = await hashPassword(newPassword, iterations);
    await run(
      db,
      `UPDATE users SET password_hash = ?, must_change_pwd = 0, updated_at = datetime('now') WHERE id = ?`,
      [hash, me.id],
    );

    await audit(db, me, 'user.password.change', me.username, '修改登录密码', getClientIp(req));
    return ok(null, '密码修改成功');
  });

  // ── 会话管理 ────────────────────────────────────────────────────────────
  r.get('/api/auth/sessions', async ({ req, env }) => {
    const db = env.DB;
    const me = await requireUser(db, req);
    const list = await listSessions(db, me.id);
    const cookies = parseCookies(req);
    const current = cookies['bc_session'] ? await sha256Base64(cookies['bc_session']) : '';
    return ok({
      list: list.map((s) => ({
        id: s.id,
        hint: s.token_hint,
        ip: s.ip,
        userAgent: s.user_agent,
        expiresAt: s.expires_at,
        createdAt: s.created_at,
        lastSeen: s.last_seen,
        current: s.id === current,
      })),
    });
  });

  r.delete('/api/auth/sessions', async ({ req, env }) => {
    const db = env.DB;
    const me = await requireUser(db, req);
    const cookies = parseCookies(req);
    if (cookies['bc_session']) await revokeOtherSessions(db, me.id, cookies['bc_session']);
    await audit(db, me, 'auth.sessions.revoke', me.username, '注销其他设备会话', getClientIp(req));
    return ok(null, '已注销其他设备的登录');
  });
}
