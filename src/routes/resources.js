/**
 * D1 / R2 / KV 资源清单管理（搜索、批量删除、增改删、实时详情）
 */
import {
  ok, err, readJson, getClientIp, requireString, optionalString,
  paginate, pageResult, requireIds, toInt,
} from '../lib/http.js';
import { one, all, run, count, inParams } from '../lib/db.js';
import { requireUser, audit } from '../lib/auth.js';
import { requireAccount, buildCfApi, buildS3 } from '../lib/repo.js';

const TYPES = {
  d1: {
    table: 'd1_databases',
    label: 'D1 数据库',
    nameField: 'database_name',
    nameLabel: '数据库名称',
    idField: 'database_id',
    idLabel: 'Database ID',
  },
  r2: {
    table: 'r2_buckets',
    label: 'R2 存储桶',
    nameField: 'bucket_name',
    nameLabel: '存储桶名称',
    idField: 'bucket_name',
    idLabel: 'Bucket Name',
  },
  kv: {
    table: 'kv_namespaces',
    label: 'KV 命名空间',
    nameField: 'title',
    nameLabel: '命名空间标题',
    idField: 'namespace_id',
    idLabel: 'Namespace ID',
  },
};

function resourceDto(type, row) {
  const cfg = TYPES[type];
  if (!row) return null;
  return {
    id: row.id,
    type,
    accountId: row.account_id,
    accountName: row.account_name || '',
    cfAccountId: row.cf_account_id || '',
    accountColor: row.account_color || 'slate',
    accountStatus: row.account_status || 'active',
    resourceId: row[cfg.idField],
    name: row[cfg.nameField],
    version: row.version || '',
    region: row.primary_location || row.location || row.region || '',
    storageClass: row.storage_class || '',
    numTables: Number(row.num_tables || 0),
    fileSize: Number(row.file_size || 0),
    rowsCount: Number(row.rows_count || 0),
    objectCount: Number(row.object_count || 0),
    totalSize: Number(row.total_size || 0),
    keyCount: Number(row.key_count || 0),
    status: row.status,
    note: row.note || '',
    remoteCreatedAt: row.remote_created || '',
    lastSyncAt: row.last_sync_at || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function registerCore(r, type) {
  const cfg = TYPES[type];
  const base = `/api/${type}`;
  const join = `FROM ${cfg.table} r LEFT JOIN cf_accounts a ON a.id = r.account_id`;

  async function loadOne(db, id) {
    return one(
      db,
      `SELECT r.*, a.name AS account_name, a.account_id AS cf_account_id,
              a.color AS account_color, a.status AS account_status
       ${join} WHERE r.id = ?`,
      [id],
    );
  }

  // ── 列表：搜索 + 分页 ───────────────────────────────────────────────────
  r.get(base, async ({ req, env, query }) => {
    const db = env.DB;
    await requireUser(db, req);
    const { page, pageSize, offset, limit } = paginate(new URL(req.url).searchParams);
    const keyword = String(query.keyword || '').trim();
    const accountId = toInt(query.accountId, 0);
    const status = String(query.status || '').trim();

    const where = [];
    const params = [];
    if (keyword) {
      where.push(`(r.${cfg.nameField} LIKE ? OR r.${cfg.idField} LIKE ? OR r.note LIKE ? OR a.name LIKE ? OR a.account_id LIKE ?)`);
      const like = `%${keyword}%`;
      params.push(like, like, like, like, like);
    }
    if (accountId) { where.push('r.account_id = ?'); params.push(accountId); }
    if (status) { where.push('r.status = ?'); params.push(status); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const join = `FROM ${cfg.table} r LEFT JOIN cf_accounts a ON a.id = r.account_id`;
    const total = await count(db, `SELECT COUNT(*) ${join} ${whereSql}`, params);
    const rows = await all(
      db,
      `SELECT r.*, a.name AS account_name, a.account_id AS cf_account_id,
              a.color AS account_color, a.status AS account_status
       ${join} ${whereSql}
       ORDER BY r.id DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    return ok(pageResult(rows.map((x) => resourceDto(type, x)), total, { page, pageSize }));
  });

  // ── 新增（手工登记）────────────────────────────────────────────────────
  r.post(base, async ({ req, env }) => {
    const db = env.DB;
    const me = await requireUser(db, req);
    const body = await readJson(req);
    const accountId = toInt(body.accountId, 0);
    await requireAccount(db, accountId);
    const name = requireString(body.name, cfg.nameLabel, { min: 1, max: 128 });
    const resourceId = requireString(body.resourceId ?? name, cfg.idLabel, { min: 1, max: 128 });
    const note = optionalString(body.note, { max: 500 });
    const dup = await one(db, `SELECT id FROM ${cfg.table} WHERE account_id = ? AND ${cfg.idField} = ?`, [accountId, resourceId]);
    if (dup) throw err.conflict(`该${cfg.label}已存在`);

    let sql;
    let bind;
    if (type === 'd1') {
      sql = `INSERT INTO d1_databases (account_id, database_id, database_name, note, status, primary_location, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'active', ?, datetime('now'), datetime('now'))`;
      bind = [accountId, resourceId, name, note, optionalString(body.region, { max: 64 })];
    } else if (type === 'r2') {
      sql = `INSERT INTO r2_buckets (account_id, bucket_name, note, status, location, created_at, updated_at)
             VALUES (?, ?, ?, 'active', ?, datetime('now'), datetime('now'))`;
      bind = [accountId, resourceId, note, optionalString(body.region, { max: 64 })];
    } else {
      sql = `INSERT INTO kv_namespaces (account_id, namespace_id, title, note, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'active', datetime('now'), datetime('now'))`;
      bind = [accountId, resourceId, name, note];
    }
    const res = await run(db, sql, bind);
    const row = await loadOne(db, res.meta.last_row_id);
    await audit(db, me, `${type}.create`, name, `ID=${resourceId}`, getClientIp(req));
    return ok({ resource: resourceDto(type, row) }, `${cfg.label}已添加`);
  });

  // ── 编辑 ────────────────────────────────────────────────────────────────
  r.put(`${base}/:id`, async ({ req, env, params }) => {
    const db = env.DB;
    const me = await requireUser(db, req);
    const id = toInt(params.id);
    const row = await one(db, `SELECT * FROM ${cfg.table} WHERE id = ?`, [id]);
    if (!row) throw err.notFound(`${cfg.label}不存在`);

    const body = await readJson(req);
    const name = requireString(body.name ?? row[cfg.nameField], cfg.nameLabel, { min: 1, max: 128 });
    const note = optionalString(body.note ?? row.note ?? '', { max: 500 });
    const status = ['active', 'disabled'].includes(body.status) ? body.status : row.status;

    await run(
      db,
      `UPDATE ${cfg.table} SET ${cfg.nameField} = ?, note = ?, status = ?, updated_at = datetime('now') WHERE id = ?`,
      [name, note, status, id],
    );
    const fresh = await loadOne(db, id);
    await audit(db, me, `${type}.update`, name, `ID=${id}`, getClientIp(req));
    return ok({ resource: resourceDto(type, fresh) }, `${cfg.label}已更新`);
  });

  // ── 删除 ────────────────────────────────────────────────────────────────
  r.delete(`${base}/:id`, async ({ req, env, params }) => {
    const db = env.DB;
    const me = await requireUser(db, req);
    const id = toInt(params.id);
    const row = await one(db, `SELECT * FROM ${cfg.table} WHERE id = ?`, [id]);
    if (!row) throw err.notFound(`${cfg.label}不存在`);
    await run(db, `DELETE FROM ${cfg.table} WHERE id = ?`, [id]);
    await audit(db, me, `${type}.delete`, row[cfg.nameField], `ID=${id}`, getClientIp(req));
    return ok(null, `${cfg.label}已删除`);
  });

  // ── 批量删除 ────────────────────────────────────────────────────────────
  r.post(`${base}/batch-delete`, async ({ req, env }) => {
    const db = env.DB;
    const me = await requireUser(db, req);
    const ids = requireIds(await readJson(req));
    const ph = inParams(ids);
    const rows = await all(db, `SELECT id, ${cfg.nameField} AS name FROM ${cfg.table} WHERE id IN (${ph})`, ids);
    await run(db, `DELETE FROM ${cfg.table} WHERE id IN (${ph})`, ids);
    await audit(db, me, `${type}.batchDelete`, rows.map((x) => x.name).join(','), `共 ${rows.length} 条`, getClientIp(req));
    return ok({ deleted: rows.length }, `已删除 ${rows.length} 条${cfg.label}记录`);
  });

  // ── 实时详情（走 Cloudflare API）────────────────────────────────────────
  r.get(`${base}/:id/remote`, async ({ req, env, params }) => {
    const db = env.DB;
    await requireUser(db, req);
    const id = toInt(params.id);
    const row = await one(db, `SELECT * FROM ${cfg.table} WHERE id = ?`, [id]);
    if (!row) throw err.notFound(`${cfg.label}不存在`);
    const account = await requireAccount(db, row.account_id);
    const api = await buildCfApi(db, env, account);

    if (type === 'd1') {
      const res = await api.getD1(row.database_id);
      return ok({ remote: res.result || null });
    }
    if (type === 'r2') {
      const res = await api.getR2Bucket(row.bucket_name);
      return ok({ remote: res.result || null });
    }
    const list = await api.getAllKvNamespaces();
    return ok({ remote: list.find((n) => String(n.id) === String(row.namespace_id)) || null });
  });
}

// ---------------------------------------------------------------------------
// 各类型专属能力
// ---------------------------------------------------------------------------

function registerExtras(r) {
  // D1：表结构 / 数据抽样
  r.get('/api/d1/:id/tables', async ({ req, env, params }) => {
    const db = env.DB;
    await requireUser(db, req);
    const row = await one(db, 'SELECT * FROM d1_databases WHERE id = ?', [toInt(params.id)]);
    if (!row) throw err.notFound('D1 数据库不存在');
    const account = await requireAccount(db, row.account_id);
    const api = await buildCfApi(db, env, account);
    const tables = await api.d1Tables(row.database_id);
    return ok({ list: tables, database: { id: row.id, name: row.database_name, databaseId: row.database_id } });
  });

  r.post('/api/d1/:id/query', async ({ req, env, params }) => {
    const db = env.DB;
    await requireUser(db, req);
    const row = await one(db, 'SELECT * FROM d1_databases WHERE id = ?', [toInt(params.id)]);
    if (!row) throw err.notFound('D1 数据库不存在');
    const body = await readJson(req);
    const sql = requireString(body.sql, 'SQL', { min: 1, max: 20000 });
    if (!/^\s*(select|pragma|explain|with)\b/i.test(sql)) {
      throw err.forbidden('出于安全考虑，此处只允许只读查询（SELECT / PRAGMA / EXPLAIN / WITH）');
    }
    const account = await requireAccount(db, row.account_id);
    const api = await buildCfApi(db, env, account);
    const result = await api.d1Query(row.database_id, sql, Array.isArray(body.params) ? body.params : []);
    return ok({ result });
  });

  // R2：对象列表（需要 R2 Access Key）
  r.get('/api/r2/:id/objects', async ({ req, env, params, query }) => {
    const db = env.DB;
    await requireUser(db, req);
    const row = await one(db, 'SELECT * FROM r2_buckets WHERE id = ?', [toInt(params.id)]);
    if (!row) throw err.notFound('R2 存储桶不存在');
    const account = await requireAccount(db, row.account_id);
    const s3 = await buildS3(db, env, account);
    const page = await s3.listObjectsV2(row.bucket_name, {
      prefix: String(query.prefix || ''),
      maxKeys: Math.min(500, toInt(query.limit, 100)),
      continuationToken: query.cursor || null,
    });
    return ok(page);
  });

  // KV：key 列表 / 值读取
  r.get('/api/kv/:id/keys', async ({ req, env, params, query }) => {
    const db = env.DB;
    await requireUser(db, req);
    const row = await one(db, 'SELECT * FROM kv_namespaces WHERE id = ?', [toInt(params.id)]);
    if (!row) throw err.notFound('KV 命名空间不存在');
    const account = await requireAccount(db, row.account_id);
    const api = await buildCfApi(db, env, account);
    const res = await api.listKvKeys(row.namespace_id, {
      prefix: String(query.prefix || ''),
      limit: Math.min(1000, toInt(query.limit, 100)),
      cursor: query.cursor || null,
    });
    return ok({ list: res.result || [], cursor: res.result_info?.cursor || '' });
  });

  r.get('/api/kv/:id/value', async ({ req, env, params, query }) => {
    const db = env.DB;
    await requireUser(db, req);
    const row = await one(db, 'SELECT * FROM kv_namespaces WHERE id = ?', [toInt(params.id)]);
    if (!row) throw err.notFound('KV 命名空间不存在');
    const key = requireString(query.key, 'Key', { min: 1, max: 512 });
    const account = await requireAccount(db, row.account_id);
    const api = await buildCfApi(db, env, account);
    const res = await api.getKvValue(row.namespace_id, key);
    const text = await res.text();
    return ok({ key, value: text.slice(0, 200000), truncated: text.length > 200000 });
  });
}

export function registerResourceRoutes(r) {
  registerCore(r, 'd1');
  registerCore(r, 'r2');
  registerCore(r, 'kv');
  registerExtras(r);
}

export { TYPES, resourceDto };
