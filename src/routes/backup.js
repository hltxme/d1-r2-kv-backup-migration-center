/**
 * 备份 / 恢复 / 跨账号迁移 与任务流水接口
 */
import {
  ok, err, raw, readJson, getClientIp, requireString, toInt, requireIds,
  paginate,
} from '../lib/http.js';
import { one, all, run, inParams } from '../lib/db.js';
import { requireUser, audit } from '../lib/auth.js';
import { requireAccount, buildCfApi, buildS3 } from '../lib/repo.js';
import {
  createTask, updateTask, finishTask, taskLog, listTasks, getTask, taskDto,
} from '../services/tasks.js';
import {
  dumpD1, restoreD1, migrateD1, dumpKV, restoreKV, migrateKV, migrateR2, dumpToSql,
} from '../services/migrate.js';

const MAX_ROWS = 50000;
const MAX_KEYS = 20000;

function requireResource(db, type, id) {
  const table = { d1: 'd1_databases', r2: 'r2_buckets', kv: 'kv_namespaces' }[type];
  return one(db, `SELECT * FROM ${table} WHERE id = ?`, [toInt(id)]);
}

function targetDescriptor(type, row) {
  if (type === 'd1') return `${row.database_name} (${row.database_id})`;
  if (type === 'r2') return `${row.bucket_name}`;
  return `${row.title} (${row.namespace_id})`;
}

export function registerBackupRoutes(r) {
  // ── 任务流水 ────────────────────────────────────────────────────────────
  r.get('/api/tasks', async ({ req, env, query }) => {
    const db = env.DB;
    await requireUser(db, req);
    const { page, pageSize } = paginate(new URL(req.url).searchParams, { defaultSize: 15 });
    const { total, list } = await listTasks(db, {
      page, pageSize,
      keyword: String(query.keyword || ''),
      status: String(query.status || ''),
      type: String(query.type || ''),
      resourceType: String(query.resourceType || ''),
    });
    return ok({
      list: list.map((t) => ({ ...taskDto(t), logs: undefined })),
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    });
  });

  r.get('/api/tasks/:id', async ({ req, env, params }) => {
    const db = env.DB;
    await requireUser(db, req);
    const row = await getTask(db, toInt(params.id));
    if (!row) throw err.notFound('任务不存在');
    return ok({ task: taskDto(row) });
  });

  r.post('/api/tasks/batch-delete', async ({ req, env }) => {
    const db = env.DB;
    const me = await requireUser(db, req);
    const ids = requireIds(await readJson(req));
    const ph = inParams(ids);
    await run(db, `DELETE FROM tasks WHERE id IN (${ph})`, ids);
    await audit(db, me, 'task.batchDelete', `ID:${ids.join(',')}`, `共 ${ids.length} 条`, getClientIp(req));
    return ok({ deleted: ids.length }, `已清理 ${ids.length} 条任务记录`);
  });

  // ── D1 导出备份 ─────────────────────────────────────────────────────────
  r.get('/api/d1/:id/export', async ({ req, env, params, query }) => {
    const db = env.DB;
    const me = await requireUser(db, req);
    const row = await requireResource(db, 'd1', params.id);
    if (!row) throw err.notFound('D1 数据库不存在');
    const account = await requireAccount(db, row.account_id);
    const api = await buildCfApi(db, env, account);

    const taskId = await createTask(db, {
      type: 'backup', resourceType: 'd1',
      title: `备份 D1：${row.database_name}`,
      sourceAccount: account.id, sourceResource: targetDescriptor('d1', row),
      createdBy: me.id,
    });
    const runner = { log: (l) => taskLog(db, taskId, l), flush: async () => {} };

    try {
      const dump = await dumpD1(api, row.database_id, { maxRowsPerTable: MAX_ROWS, runner });
      await finishTask(db, taskId, 'success', `导出 ${dump.tables.length} 张表`);
      await audit(db, me, 'd1.backup', row.database_name, `表 ${dump.tables.length} 张`, getClientIp(req));

      const format = String(query.format || 'sql').toLowerCase();
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      if (format === 'json') {
        return raw(JSON.stringify(dump, null, 2), {
          type: 'application/json; charset=utf-8',
          filename: `${row.database_name}-${stamp}.json`,
        });
      }
      return raw(dumpToSql(dump), {
        type: 'application/sql; charset=utf-8',
        filename: `${row.database_name}-${stamp}.sql`,
      });
    } catch (e) {
      await finishTask(db, taskId, 'failed', e.message);
      throw e;
    }
  });

  // ── D1 跨账号迁移 ───────────────────────────────────────────────────────
  r.post('/api/d1/:id/migrate', async ({ req, env, params }) => {
    const db = env.DB;
    const me = await requireUser(db, req);
    const srcRow = await requireResource(db, 'd1', params.id);
    if (!srcRow) throw err.notFound('源 D1 数据库不存在');
    const body = await readJson(req);
    const targetAccountId = toInt(body.targetAccountId, 0);
    const targetAccount = await requireAccount(db, targetAccountId);
    const sourceAccount = await requireAccount(db, srcRow.account_id);
    if (targetAccountId === sourceAccount.id && !body.targetDatabaseId && !body.targetDatabaseName) {
      throw err.badRequest('同账号迁移时请指定目标数据库');
    }

    const sourceApi = await buildCfApi(db, env, sourceAccount);
    const targetApi = await buildCfApi(db, env, targetAccount);

    let targetDbId = String(body.targetDatabaseId || '').trim();
    let targetName = String(body.targetDatabaseName || '').trim();
    if (!targetDbId) {
      if (!targetName) targetName = `${srcRow.database_name}-migrated`;
      const created = await targetApi.createD1(targetName);
      targetDbId = created.result?.uuid || created.result?.database_id || '';
      if (!targetDbId) throw err.upstream('目标 D1 创建失败，未返回 database_id');
    }

    const taskId = await createTask(db, {
      type: 'migrate', resourceType: 'd1',
      title: `迁移 D1：${srcRow.database_name} → ${targetName || targetDbId}`,
      sourceAccount: sourceAccount.id, sourceResource: targetDescriptor('d1', srcRow),
      targetAccount: targetAccount.id, targetResource: `${targetName || ''} (${targetDbId})`,
      createdBy: me.id,
    });

    const runner = new (class {
      constructor() { this.done = 0; this.total = 0; this.bytesDone = 0; this.bytesTotal = 0; this.last = 0; }
      async log(line) { await taskLog(db, taskId, line); }
      async flush(force = false) {
        const now = Date.now();
        if (!force && now - this.last < 500) return;
        this.last = now;
        await updateTask(db, taskId, {
          progress: this.total ? Math.min(99, Math.round((this.done / this.total) * 100)) : 0,
          doneItems: this.done, totalItems: this.total,
          bytesDone: this.bytesDone, bytesTotal: this.bytesTotal,
        });
      }
    })();

    try {
      const result = await migrateD1({
        sourceApi, sourceDbId: srcRow.database_id,
        targetApi, targetDbId,
        maxRowsPerTable: MAX_ROWS, runner,
      });
      await finishTask(db, taskId, 'success', `迁移完成：${result.tables} 表 / ${result.rows} 行`);
      await audit(db, me, 'd1.migrate', `${srcRow.database_name} → ${targetName || targetDbId}`, JSON.stringify(result), getClientIp(req));
      return ok({ task: taskDto(await getTask(db, taskId)), result }, 'D1 跨账号迁移完成');
    } catch (e) {
      await finishTask(db, taskId, 'failed', e.message);
      throw e;
    }
  });

  // ── D1 恢复（上传备份文件）─────────────────────────────────────────────
  r.post('/api/d1/restore', async ({ req, env }) => {
    const db = env.DB;
    const me = await requireUser(db, req);
    const body = await readJson(req);
    const targetAccountId = toInt(body.targetAccountId, 0);
    const targetDatabaseId = requireString(body.targetDatabaseId, '目标 Database ID', { min: 1, max: 128 });
    const dump = body.dump;
    if (!dump || !Array.isArray(dump.tables)) throw err.badRequest('备份文件格式不正确，缺少 tables');
    const account = await requireAccount(db, targetAccountId);
    const api = await buildCfApi(db, env, account);

    const taskId = await createTask(db, {
      type: 'restore', resourceType: 'd1',
      title: `恢复 D1 → ${targetDatabaseId}`,
      targetAccount: account.id, targetResource: targetDatabaseId,
      createdBy: me.id,
    });
    const runner = new (class {
      constructor() { this.done = 0; this.total = dump.tables.reduce((s, t) => s + (t.rows?.length || 0), 0); this.bytesDone = 0; this.bytesTotal = 0; this.last = 0; }
      async log(line) { await taskLog(db, taskId, line); }
      async flush(force = false) {
        const now = Date.now();
        if (!force && now - this.last < 500) return;
        this.last = now;
        await updateTask(db, taskId, {
          progress: this.total ? Math.min(99, Math.round((this.done / this.total) * 100)) : 0,
          doneItems: this.done, totalItems: this.total,
        });
      }
    })();

    try {
      const result = await restoreD1(api, targetDatabaseId, dump, { runner, dropExisting: Boolean(body.dropExisting) });
      await finishTask(db, taskId, 'success', `恢复完成：${result.inserted} 行`);
      await audit(db, me, 'd1.restore', targetDatabaseId, JSON.stringify(result), getClientIp(req));
      return ok({ task: taskDto(await getTask(db, taskId)), result }, 'D1 恢复完成');
    } catch (e) {
      await finishTask(db, taskId, 'failed', e.message);
      throw e;
    }
  });

  // ── KV 导出 ─────────────────────────────────────────────────────────────
  r.get('/api/kv/:id/export', async ({ req, env, params }) => {
    const db = env.DB;
    const me = await requireUser(db, req);
    const row = await requireResource(db, 'kv', params.id);
    if (!row) throw err.notFound('KV 命名空间不存在');
    const account = await requireAccount(db, row.account_id);
    const api = await buildCfApi(db, env, account);

    const taskId = await createTask(db, {
      type: 'backup', resourceType: 'kv',
      title: `备份 KV：${row.title}`,
      sourceAccount: account.id, sourceResource: targetDescriptor('kv', row),
      createdBy: me.id,
    });
    try {
      const dump = await dumpKV(api, row.namespace_id, {
        maxKeys: MAX_KEYS,
        runner: { log: (l) => taskLog(db, taskId, l), flush: async () => {} },
      });
      await finishTask(db, taskId, 'success', `导出 ${dump.entries.length} 个键`);
      await audit(db, me, 'kv.backup', row.title, `${dump.entries.length} keys`, getClientIp(req));
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      return raw(JSON.stringify(dump, null, 2), {
        type: 'application/json; charset=utf-8',
        filename: `${row.title}-${stamp}.kv.json`,
      });
    } catch (e) {
      await finishTask(db, taskId, 'failed', e.message);
      throw e;
    }
  });

  // ── KV 跨账号迁移 ───────────────────────────────────────────────────────
  r.post('/api/kv/:id/migrate', async ({ req, env, params }) => {
    const db = env.DB;
    const me = await requireUser(db, req);
    const srcRow = await requireResource(db, 'kv', params.id);
    if (!srcRow) throw err.notFound('源 KV 命名空间不存在');
    const body = await readJson(req);
    const targetAccountId = toInt(body.targetAccountId, 0);
    const targetAccount = await requireAccount(db, targetAccountId);
    const sourceAccount = await requireAccount(db, srcRow.account_id);

    const sourceApi = await buildCfApi(db, env, sourceAccount);
    const targetApi = await buildCfApi(db, env, targetAccount);

    let targetNsId = String(body.targetNamespaceId || '').trim();
    let targetTitle = String(body.targetTitle || '').trim();
    if (!targetNsId) {
      if (!targetTitle) targetTitle = `${srcRow.title}-migrated`;
      const created = await targetApi.createKvNamespace(targetTitle);
      targetNsId = created.result?.id || '';
      if (!targetNsId) throw err.upstream('目标 KV 命名空间创建失败');
    }

    const taskId = await createTask(db, {
      type: 'migrate', resourceType: 'kv',
      title: `迁移 KV：${srcRow.title} → ${targetTitle || targetNsId}`,
      sourceAccount: sourceAccount.id, sourceResource: targetDescriptor('kv', srcRow),
      targetAccount: targetAccount.id, targetResource: `${targetTitle || ''} (${targetNsId})`,
      createdBy: me.id,
    });

    const runner = new (class {
      constructor() { this.done = 0; this.total = 0; this.bytesDone = 0; this.bytesTotal = 0; this.last = 0; }
      async log(line) { await taskLog(db, taskId, line); }
      async flush(force = false) {
        const now = Date.now();
        if (!force && now - this.last < 500) return;
        this.last = now;
        await updateTask(db, taskId, {
          progress: this.total ? Math.min(99, Math.round((this.done / this.total) * 100)) : 0,
          doneItems: this.done, totalItems: this.total,
          bytesDone: this.bytesDone, bytesTotal: this.bytesTotal,
        });
      }
    })();

    try {
      const result = await migrateKV({
        sourceApi, sourceNsId: srcRow.namespace_id,
        targetApi, targetNsId,
        maxKeys: MAX_KEYS, runner,
      });
      await finishTask(db, taskId, 'success', `迁移完成：${result.keys} 个键`);
      await audit(db, me, 'kv.migrate', `${srcRow.title} → ${targetTitle || targetNsId}`, JSON.stringify(result), getClientIp(req));
      return ok({ task: taskDto(await getTask(db, taskId)), result }, 'KV 跨账号迁移完成');
    } catch (e) {
      await finishTask(db, taskId, 'failed', e.message);
      throw e;
    }
  });

  // ── R2 对象清单导出 ─────────────────────────────────────────────────────
  r.get('/api/r2/:id/manifest', async ({ req, env, params, query }) => {
    const db = env.DB;
    const me = await requireUser(db, req);
    const row = await requireResource(db, 'r2', params.id);
    if (!row) throw err.notFound('R2 存储桶不存在');
    const account = await requireAccount(db, row.account_id);
    const s3 = await buildS3(db, env, account);
    const objects = await s3.listAllObjects(row.bucket_name, {
      prefix: String(query.prefix || ''),
      maxKeys: 20000,
    });
    await audit(db, me, 'r2.manifest', row.bucket_name, `${objects.length} objects`, getClientIp(req));
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    return raw(JSON.stringify({ bucket: row.bucket_name, exportedAt: new Date().toISOString(), objects }, null, 2), {
      type: 'application/json; charset=utf-8',
      filename: `${row.bucket_name}-${stamp}.manifest.json`,
    });
  });

  // ── R2 跨账号/跨桶迁移 ─────────────────────────────────────────────────
  r.post('/api/r2/:id/migrate', async ({ req, env, params }) => {
    const db = env.DB;
    const me = await requireUser(db, req);
    const srcRow = await requireResource(db, 'r2', params.id);
    if (!srcRow) throw err.notFound('源 R2 存储桶不存在');
    const body = await readJson(req);
    const targetAccountId = toInt(body.targetAccountId, 0);
    const targetAccount = await requireAccount(db, targetAccountId);
    const sourceAccount = await requireAccount(db, srcRow.account_id);

    const targetBucket = String(body.targetBucketName || '').trim() || `${srcRow.bucket_name}-migrated`;
    const sourceS3 = await buildS3(db, env, sourceAccount);
    const targetS3 = await buildS3(db, env, targetAccount);

    const targetApi = await buildCfApi(db, env, targetAccount);
    if (body.createTargetBucket) {
      try {
        await targetApi.createR2Bucket(targetBucket, String(body.targetLocation || ''));
      } catch (e) {
        if (!/already|exist/i.test(String(e.message))) throw e;
      }
    }

    const taskId = await createTask(db, {
      type: 'migrate', resourceType: 'r2',
      title: `迁移 R2：${srcRow.bucket_name} → ${targetBucket}`,
      sourceAccount: sourceAccount.id, sourceResource: srcRow.bucket_name,
      targetAccount: targetAccount.id, targetResource: targetBucket,
      createdBy: me.id,
    });

    const runner = new (class {
      constructor() { this.done = 0; this.total = 0; this.bytesDone = 0; this.bytesTotal = 0; this.last = 0; }
      async log(line) { await taskLog(db, taskId, line); }
      async flush(force = false) {
        const now = Date.now();
        if (!force && now - this.last < 500) return;
        this.last = now;
        await updateTask(db, taskId, {
          progress: this.total ? Math.min(99, Math.round((this.done / this.total) * 100)) : 0,
          doneItems: this.done, totalItems: this.total,
          bytesDone: this.bytesDone, bytesTotal: this.bytesTotal,
        });
      }
    })();

    try {
      const result = await migrateR2({
        sourceS3, sourceBucket: srcRow.bucket_name,
        targetS3, targetBucket,
        prefix: String(body.prefix || ''),
        maxObjects: toInt(body.maxObjects, 5000) || 5000,
        runner,
      });
      const status = result.failed ? 'success' : 'success';
      await finishTask(db, taskId, status, `复制 ${result.copied} 个对象，失败 ${result.failed}`);
      await audit(db, me, 'r2.migrate', `${srcRow.bucket_name} → ${targetBucket}`, JSON.stringify(result), getClientIp(req));
      return ok({ task: taskDto(await getTask(db, taskId)), result }, 'R2 迁移完成');
    } catch (e) {
      await finishTask(db, taskId, 'failed', e.message);
      throw e;
    }
  });

  // ── KV 恢复（上传备份文件）─────────────────────────────────────────────
  r.post('/api/kv/restore', async ({ req, env }) => {
    const db = env.DB;
    const me = await requireUser(db, req);
    const body = await readJson(req);
    const targetAccountId = toInt(body.targetAccountId, 0);
    const targetNamespaceId = requireString(body.targetNamespaceId, '目标 Namespace ID', { min: 1, max: 128 });
    const dump = body.dump;
    if (!dump || !Array.isArray(dump.entries)) throw err.badRequest('备份文件格式不正确，缺少 entries');
    const account = await requireAccount(db, targetAccountId);
    const api = await buildCfApi(db, env, account);

    const taskId = await createTask(db, {
      type: 'restore', resourceType: 'kv',
      title: `恢复 KV → ${targetNamespaceId}`,
      targetAccount: account.id, targetResource: targetNamespaceId,
      createdBy: me.id,
    });
    const runner = new (class {
      constructor() { this.done = 0; this.total = dump.entries.length; this.bytesDone = 0; this.bytesTotal = 0; this.last = 0; }
      async log(line) { await taskLog(db, taskId, line); }
      async flush(force = false) {
        const now = Date.now();
        if (!force && now - this.last < 500) return;
        this.last = now;
        await updateTask(db, taskId, {
          progress: this.total ? Math.min(99, Math.round((this.done / this.total) * 100)) : 0,
          doneItems: this.done, totalItems: this.total,
        });
      }
    })();

    try {
      const result = await restoreKV(api, targetNamespaceId, dump.entries, { runner });
      await finishTask(db, taskId, 'success', `恢复完成：${result.written} 个键`);
      await audit(db, me, 'kv.restore', targetNamespaceId, JSON.stringify(result), getClientIp(req));
      return ok({ task: taskDto(await getTask(db, taskId)), result }, 'KV 恢复完成');
    } catch (e) {
      await finishTask(db, taskId, 'failed', e.message);
      throw e;
    }
  });

  // ── 创建“备份到指定账号”计划任务（轻量登记，便于审计）────────────────
  r.post('/api/:type/:id/backup', async ({ req, env, params }) => {
    const db = env.DB;
    const me = await requireUser(db, req);
    const type = String(params.type);
    if (!['d1', 'r2', 'kv'].includes(type)) throw err.badRequest('不支持的资源类型');
    const row = await requireResource(db, type, params.id);
    if (!row) throw err.notFound('资源不存在');
    const body = await readJson(req);
    const targetAccountId = toInt(body.targetAccountId, 0);
    const targetAccount = await requireAccount(db, targetAccountId);
    const sourceAccount = await requireAccount(db, row.account_id);

    const label = row.database_name || row.bucket_name || row.title;
    const taskId = await createTask(db, {
      type: 'backup', resourceType: type,
      title: `备份计划 ${type.toUpperCase()}：${label}`,
      sourceAccount: sourceAccount.id, sourceResource: targetDescriptor(type, row),
      targetAccount: targetAccount.id, targetResource: String(body.targetLabel || '备份账号'),
      createdBy: me.id,
    });
    await taskLog(db, taskId, `已登记备份计划，目标账号：${targetAccount.name}（${targetAccount.account_id}）`);
    await finishTask(db, taskId, 'success', '备份计划已登记');
    return ok({ task: taskDto(await getTask(db, taskId)) }, '备份计划已创建');
  });
}
