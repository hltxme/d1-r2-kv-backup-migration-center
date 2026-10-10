/**
 * CF 账号管理：增删改查、连通性测试、资源同步
 */
import {
  ok, err, readJson, getClientIp, requireString, optionalString,
  paginate, pageResult, requireIds, toInt,
} from '../lib/http.js';
import { one, all, run, count, getAppSecret, inParams } from '../lib/db.js';
import { encryptSecret } from '../lib/crypto.js';
import { requireUser, audit } from '../lib/auth.js';
import {
  accountDto, getAccountById, requireAccount,
  buildCfApi, attachAccountStats,
} from '../lib/repo.js';

const COLORS = ['indigo', 'blue', 'cyan', 'teal', 'green', 'amber', 'orange', 'rose', 'violet', 'slate'];

function tokenHint(token) {
  const t = String(token || '');
  return t.length > 10 ? `${t.slice(0, 6)}…${t.slice(-4)}` : '••••';
}

export function registerAccountRoutes(r) {
  // ── 列表 ────────────────────────────────────────────────────────────────
  r.get('/api/accounts', async ({ req, env, query }) => {
    const db = env.DB;
    const me = await requireUser(db, req);
    const { page, pageSize, offset, limit } = paginate(new URL(req.url).searchParams);
    const keyword = String(query.keyword || '').trim();
    const status = String(query.status || '').trim();

    const where = [];
    const params = [];
    if (keyword) {
      where.push('(name LIKE ? OR account_id LIKE ? OR account_name LIKE ? OR note LIKE ?)');
      const like = `%${keyword}%`;
      params.push(like, like, like, like);
    }
    if (status) { where.push('status = ?'); params.push(status); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const total = await count(db, `SELECT COUNT(*) FROM cf_accounts ${whereSql}`, params);
    const rows = await all(
      db,
      `SELECT * FROM cf_accounts ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    const withStats = await attachAccountStats(db, rows);
    return ok(pageResult(withStats.map(accountDto), total, { page, pageSize }));
  });

  // ── 下拉选项 ────────────────────────────────────────────────────────────
  r.get('/api/accounts/options', async ({ req, env }) => {
    const db = env.DB;
    await requireUser(db, req);
    const rows = await all(db, 'SELECT id, name, account_id, status, color FROM cf_accounts ORDER BY name ASC');
    return ok({ list: rows });
  });

  // ── 详情 ────────────────────────────────────────────────────────────────
  r.get('/api/accounts/:id', async ({ req, env, params }) => {
    const db = env.DB;
    await requireUser(db, req);
    const row = await requireAccount(db, toInt(params.id));
    const withStats = await attachAccountStats(db, [row]);
    return ok({ account: accountDto(withStats[0]) });
  });

  // ── 新增 ────────────────────────────────────────────────────────────────
  r.post('/api/accounts', async ({ req, env }) => {
    const db = env.DB;
    const me = await requireUser(db, req);
    const body = await readJson(req);

    const name = requireString(body.name, '账号名称', { min: 1, max: 64 });
    const accountId = requireString(body.accountId, 'Account ID', { min: 8, max: 64 });
    const apiToken = requireString(body.apiToken, 'API Token', { min: 8, max: 400 });
    const note = optionalString(body.note, { max: 500 });
    const color = COLORS.includes(body.color) ? body.color : 'indigo';

    const dup = await one(db, 'SELECT id FROM cf_accounts WHERE account_id = ?', [accountId]);
    if (dup) throw err.conflict('该 Account ID 已添加过');

    const secret = await getAppSecret(db, env);
    const encToken = await encryptSecret(apiToken, secret);
    const encR2Secret = body.r2SecretAccessKey
      ? await encryptSecret(String(body.r2SecretAccessKey), secret)
      : '';

    const res = await run(
      db,
      `INSERT INTO cf_accounts (name, account_id, api_token, api_token_hint, r2_access_key_id, r2_secret_access_key,
              r2_endpoint, status, color, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [
        name, accountId, encToken, tokenHint(apiToken),
        optionalString(body.r2AccessKeyId, { max: 128 }),
        encR2Secret,
        optionalString(body.r2Endpoint, { max: 200 }),
        body.status === 'disabled' ? 'disabled' : 'active',
        color, note,
      ],
    );

    const row = await getAccountById(db, res.meta.last_row_id);
    await audit(db, me, 'account.create', name, `AccountID=${accountId}`, getClientIp(req));
    return ok({ account: accountDto(row) }, 'CF 账号已添加');
  });

  // ── 编辑 ────────────────────────────────────────────────────────────────
  r.put('/api/accounts/:id', async ({ req, env, params }) => {
    const db = env.DB;
    const me = await requireUser(db, req);
    const id = toInt(params.id);
    const row = await requireAccount(db, id);
    const body = await readJson(req);

    const name = requireString(body.name ?? row.name, '账号名称', { min: 1, max: 64 });
    const accountId = requireString(body.accountId ?? row.account_id, 'Account ID', { min: 8, max: 64 });
    const note = optionalString(body.note ?? row.note ?? '', { max: 500 });
    const color = COLORS.includes(body.color) ? body.color : (row.color || 'indigo');
    const status = ['active', 'disabled'].includes(body.status) ? body.status : row.status;

    const dup = await one(db, 'SELECT id FROM cf_accounts WHERE account_id = ? AND id <> ?', [accountId, id]);
    if (dup) throw err.conflict('该 Account ID 已被其他记录占用');

    const secret = await getAppSecret(db, env);
    let encToken = row.api_token;
    let hint = row.api_token_hint;
    if (body.apiToken !== undefined && String(body.apiToken).trim()) {
      encToken = await encryptSecret(String(body.apiToken).trim(), secret);
      hint = tokenHint(String(body.apiToken).trim());
    }

    let encR2Secret = row.r2_secret_access_key || '';
    if (body.r2SecretAccessKey !== undefined && String(body.r2SecretAccessKey).trim()) {
      encR2Secret = await encryptSecret(String(body.r2SecretAccessKey).trim(), secret);
    }
    if (body.clearR2Key) encR2Secret = '';

    await run(
      db,
      `UPDATE cf_accounts SET name = ?, account_id = ?, api_token = ?, api_token_hint = ?,
              r2_access_key_id = ?, r2_secret_access_key = ?, r2_endpoint = ?,
              status = ?, color = ?, note = ?, updated_at = datetime('now')
        WHERE id = ?`,
      [
        name, accountId, encToken, hint,
        optionalString(body.r2AccessKeyId ?? row.r2_access_key_id ?? '', { max: 128 }),
        encR2Secret,
        optionalString(body.r2Endpoint ?? row.r2_endpoint ?? '', { max: 200 }),
        status, color, note, id,
      ],
    );

    const fresh = await getAccountById(db, id);
    await audit(db, me, 'account.update', name, `ID=${id}`, getClientIp(req));
    return ok({ account: accountDto(fresh) }, 'CF 账号已更新');
  });

  // ── 删除（单个）────────────────────────────────────────────────────────
  r.delete('/api/accounts/:id', async ({ req, env, params }) => {
    const db = env.DB;
    const me = await requireUser(db, req);
    const id = toInt(params.id);
    const row = await requireAccount(db, id);
    await run(db, 'DELETE FROM cf_accounts WHERE id = ?', [id]);
    await audit(db, me, 'account.delete', row.name, `ID=${id}`, getClientIp(req));
    return ok(null, 'CF 账号已删除（关联资源记录一并清除）');
  });

  // ── 批量删除 ────────────────────────────────────────────────────────────
  r.post('/api/accounts/batch-delete', async ({ req, env }) => {
    const db = env.DB;
    const me = await requireUser(db, req);
    const ids = requireIds(await readJson(req));
    const ph = inParams(ids);
    const rows = await all(db, `SELECT id, name FROM cf_accounts WHERE id IN (${ph})`, ids);
    await run(db, `DELETE FROM cf_accounts WHERE id IN (${ph})`, ids);
    await audit(db, me, 'account.batchDelete', rows.map((x) => x.name).join(','), `共 ${rows.length} 个`, getClientIp(req));
    return ok({ deleted: rows.length }, `已删除 ${rows.length} 个 CF 账号`);
  });

  // ── 连通性测试 ──────────────────────────────────────────────────────────
  r.post('/api/accounts/:id/test', async ({ req, env, params }) => {
    const db = env.DB;
    await requireUser(db, req);
    const row = await requireAccount(db, toInt(params.id));
    const api = await buildCfApi(db, env, row);
    const probe = await api.probe();
    return ok(probe, probe.tokenValid ? 'Token 有效，连接正常' : 'Token 校验未通过');
  });

  // ── 从 Cloudflare 同步资源清单 ──────────────────────────────────────────
  r.post('/api/accounts/:id/sync', async ({ req, env, params }) => {
    const db = env.DB;
    const me = await requireUser(db, req);
    const id = toInt(params.id);
    const row = await requireAccount(db, id);
    const api = await buildCfApi(db, env, row);

    const summary = { d1: 0, r2: 0, kv: 0, errors: [] };

    // 账号名
    try {
      const account = await api.getAccount();
      await run(db, 'UPDATE cf_accounts SET account_name = ?, plan = ?, updated_at = datetime(\'now\') WHERE id = ?', [
        account?.name || row.account_name || '', account?.type || row.plan || '', id,
      ]);
    } catch (e) {
      summary.errors.push(`账号信息：${e.message}`);
    }

    // D1
    try {
      const list = await api.getAllD1();
      for (const item of list) {
        await run(
          db,
          `INSERT INTO d1_databases (account_id, database_id, database_name, version, primary_location, num_tables,
                  file_size, rows_count, status, remote_created, last_sync_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, datetime('now'), datetime('now'), datetime('now'))
           ON CONFLICT(account_id, database_id) DO UPDATE SET
             database_name = excluded.database_name,
             version = excluded.version,
             primary_location = excluded.primary_location,
             num_tables = excluded.num_tables,
             file_size = excluded.file_size,
             last_sync_at = datetime('now'),
             updated_at = datetime('now')`,
          [
            id, item.uuid || item.database_id, item.name, item.version || '',
            item.primary_location || item.running_in_region || '',
            Number(item.num_tables || 0), Number(item.file_size || 0), Number(item.rows_count || 0),
            item.created_at || '',
          ],
        );
        summary.d1 += 1;
      }
    } catch (e) {
      summary.errors.push(`D1：${e.message}`);
    }

    // R2
    try {
      const list = await api.getAllR2Buckets();
      for (const b of list) {
        await run(
          db,
          `INSERT INTO r2_buckets (account_id, bucket_name, location, storage_class, object_count, total_size,
                  status, remote_created, last_sync_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'active', ?, datetime('now'), datetime('now'), datetime('now'))
           ON CONFLICT(account_id, bucket_name) DO UPDATE SET
             location = excluded.location,
             storage_class = excluded.storage_class,
             object_count = excluded.object_count,
             total_size = excluded.total_size,
             last_sync_at = datetime('now'),
             updated_at = datetime('now')`,
          [
            id, b.name, b.location || b.location_hint || '',
            b.storage_class || 'Standard',
            Number(b.object_count ?? b.objectCount ?? 0),
            Number(b.size ?? b.total_size ?? 0),
            b.creation_date || b.created_at || '',
          ],
        );
        summary.r2 += 1;
      }
    } catch (e) {
      summary.errors.push(`R2：${e.message}`);
    }

    // KV
    try {
      const list = await api.getAllKvNamespaces();
      for (const ns of list) {
        await run(
          db,
          `INSERT INTO kv_namespaces (account_id, namespace_id, title, region, status, remote_created, last_sync_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'active', ?, datetime('now'), datetime('now'), datetime('now'))
           ON CONFLICT(account_id, namespace_id) DO UPDATE SET
             title = excluded.title,
             last_sync_at = datetime('now'),
             updated_at = datetime('now')`,
          [id, ns.id, ns.title, ns.region || '', ns.created_at || ''],
        );
        summary.kv += 1;
      }
    } catch (e) {
      summary.errors.push(`KV：${e.message}`);
    }

    await run(db, 'UPDATE cf_accounts SET last_sync_at = datetime(\'now\'), updated_at = datetime(\'now\') WHERE id = ?', [id]);
    await audit(db, me, 'account.sync', row.name, `D1=${summary.d1} R2=${summary.r2} KV=${summary.kv}`, getClientIp(req));

    return ok(summary, `同步完成：D1 ${summary.d1} 个 / R2 ${summary.r2} 个 / KV ${summary.kv} 个`);
  });

  // ── 远端资源一览（实时查询，不落库）────────────────────────────────────
  r.get('/api/accounts/:id/remote', async ({ req, env, params }) => {
    const db = env.DB;
    await requireUser(db, req);
    const row = await requireAccount(db, toInt(params.id));
    const api = await buildCfApi(db, env, row);
    const [d1, r2, kv] = await Promise.allSettled([
      api.getAllD1(), api.getAllR2Buckets(), api.getAllKvNamespaces(),
    ]);
    return ok({
      d1: d1.status === 'fulfilled' ? d1.value : [],
      r2: r2.status === 'fulfilled' ? r2.value : [],
      kv: kv.status === 'fulfilled' ? kv.value : [],
      errors: [
        d1.status === 'rejected' ? `D1: ${d1.reason?.message}` : null,
        r2.status === 'rejected' ? `R2: ${r2.reason?.message}` : null,
        kv.status === 'rejected' ? `KV: ${kv.reason?.message}` : null,
      ].filter(Boolean),
    });
  });
}
