/**
 * 仪表盘 / 应用设置 / 审计日志
 */
import { ok, paginate, pageResult } from '../lib/http.js';
import { requireUser } from '../lib/auth.js';
import { one, all, count, isAutoSecret } from '../lib/db.js';
import { resourceStats } from '../lib/repo.js';
import { taskDto } from '../services/tasks.js';

export function registerDashboardRoutes(r) {
  // ── 概览 ────────────────────────────────────────────────────────────────
  r.get('/api/dashboard/summary', async ({ req, env }) => {
    const db = env.DB;
    const user = await requireUser(db, req);
    const stats = await resourceStats(db);

    const [recentTasks, recentAudit, running, failed, accountsByStatus] = await Promise.all([
      all(db, `SELECT t.*, sa.name AS source_account_name, ta.name AS target_account_name
                 FROM tasks t
                 LEFT JOIN cf_accounts sa ON sa.id = t.source_account
                 LEFT JOIN cf_accounts ta ON ta.id = t.target_account
                ORDER BY t.id DESC LIMIT 8`),
      all(db, 'SELECT id, username, action, target, detail, ip, created_at FROM audit_logs ORDER BY id DESC LIMIT 10'),
      count(db, "SELECT COUNT(*) FROM tasks WHERE status = 'running'"),
      count(db, "SELECT COUNT(*) FROM tasks WHERE status = 'failed'"),
      all(db, 'SELECT status, COUNT(*) c FROM cf_accounts GROUP BY status'),
    ]);

    const autoSecret = await isAutoSecret(db, env);

    return ok({
      stats,
      tasks: {
        running,
        failed,
        total: await count(db, 'SELECT COUNT(*) FROM tasks'),
        recent: recentTasks.map((t) => ({ ...taskDto(t), logs: undefined })),
      },
      accountsByStatus: Object.fromEntries(accountsByStatus.map((r) => [r.status, r.c])),
      audit: recentAudit,
      security: {
        autoSecret,
        sessionTtlDays: parseInt(env.SESSION_TTL_DAYS || '7', 10),
        captchaEnabled: true,
      },
      server: {
        appName: env.APP_NAME || 'Backup Center',
        version: env.APP_VERSION || '1.0.0',
        locale: env.APP_DEFAULT_LOCALE || 'zh-CN',
        theme: env.APP_DEFAULT_THEME || 'light',
        accent: env.APP_DEFAULT_ACCENT || 'indigo',
        now: new Date().toISOString(),
      },
    });
  });

  // ── 应用信息（登录页也用）──────────────────────────────────────────────
  r.get('/api/settings', async ({ env }) => {
    return ok({
      appName: env.APP_NAME || 'D1 + R2 + KV Backup Center',
      shortName: env.APP_SHORT_NAME || 'Backup Center',
      version: env.APP_VERSION || '1.0.0',
      defaultLocale: env.APP_DEFAULT_LOCALE || 'zh-CN',
      defaultTheme: env.APP_DEFAULT_THEME || 'light',
      defaultAccent: env.APP_DEFAULT_ACCENT || 'indigo',
      locales: [
        { id: 'zh-CN', label: '简体中文', flag: '🇨🇳' },
        { id: 'en', label: 'English', flag: '🇺🇸' },
      ],
    });
  });

  // ── 审计日志 ────────────────────────────────────────────────────────────
  r.get('/api/audit', async ({ req, env, query }) => {
    const db = env.DB;
    await requireUser(db, req);
    const { page, pageSize, offset, limit } = paginate(new URL(req.url).searchParams, { defaultSize: 20 });
    const keyword = String(query.keyword || '').trim();
    const where = [];
    const params = [];
    if (keyword) {
      where.push('(username LIKE ? OR action LIKE ? OR target LIKE ? OR detail LIKE ?)');
      const like = `%${keyword}%`;
      params.push(like, like, like, like);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = await count(db, `SELECT COUNT(*) FROM audit_logs ${whereSql}`, params);
    const list = await all(
      db,
      `SELECT * FROM audit_logs ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    return ok(pageResult(list, total, { page, pageSize }));
  });

  // ── 系统体检 ────────────────────────────────────────────────────────────
  r.get('/api/health/detail', async ({ req, env }) => {
    const db = env.DB;
    await requireUser(db, req);
    const checks = [];
    const push = (name, okFlag, detail) => checks.push({ name, ok: okFlag, detail });

    try {
      await count(db, 'SELECT COUNT(*) FROM users');
      push('D1 元数据库', true, '连接正常');
    } catch (e) {
      push('D1 元数据库', false, e.message);
    }

    try {
      const n = await count(db, 'SELECT COUNT(*) FROM users');
      push('用户表', n > 0, `${n} 个账号`);
    } catch (e) {
      push('用户表', false, e.message);
    }

    const autoSecret = await isAutoSecret(db, env);
    push('加密密钥', !autoSecret, autoSecret ? '正在使用自动生成的密钥，建议设置 wrangler secret put APP_SECRET' : '已使用 APP_SECRET');

    const expired = await count(db, "SELECT COUNT(*) FROM sessions WHERE expires_at <= datetime('now')");
    push('会话清理', true, `${expired} 条过期会话待清理`);

    return ok({ checks, checkedAt: new Date().toISOString() });
  });
}
