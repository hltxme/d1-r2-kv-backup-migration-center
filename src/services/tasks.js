/**
 * 任务流水：备份 / 迁移 / 恢复 任务的创建、日志与进度
 */
import { one, run, all, count } from '../lib/db.js';
import { randomToken } from '../lib/crypto.js';

export function newTaskNo() {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, '0');
  const stamp = `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
  return `T-${stamp}-${randomToken(4).toUpperCase()}`;
}

export async function createTask(db, {
  type, resourceType, title,
  sourceAccount = null, sourceResource = '',
  targetAccount = null, targetResource = '',
  totalItems = 0, bytesTotal = 0, createdBy = null,
}) {
  const taskNo = newTaskNo();
  const res = await run(
    db,
    `INSERT INTO tasks (task_no, type, resource_type, title, source_account, source_resource,
            target_account, target_resource, status, progress, total_items, bytes_total, log,
            started_at, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running', 0, ?, ?, '[]', datetime('now'), ?, datetime('now'), datetime('now'))`,
    [taskNo, type, resourceType, title, sourceAccount, sourceResource, targetAccount, targetResource, totalItems, bytesTotal, createdBy],
  );
  return res.meta.last_row_id;
}

export async function taskLog(db, taskId, line) {
  const row = await one(db, 'SELECT log FROM tasks WHERE id = ?', [taskId]);
  let logs = [];
  try { logs = JSON.parse(row?.log || '[]'); } catch { logs = []; }
  logs.push(`[${new Date().toISOString()}] ${line}`);
  if (logs.length > 500) logs = logs.slice(-500);
  await run(db, 'UPDATE tasks SET log = ?, updated_at = datetime(\'now\') WHERE id = ?', [JSON.stringify(logs), taskId]);
}

export async function updateTask(db, taskId, patch = {}) {
  const fields = [];
  const params = [];
  const map = {
    status: 'status', progress: 'progress', totalItems: 'total_items',
    doneItems: 'done_items', bytesTotal: 'bytes_total', bytesDone: 'bytes_done',
    message: 'message', targetResource: 'target_resource', startedAt: 'started_at',
  };
  for (const [k, col] of Object.entries(map)) {
    if (patch[k] !== undefined) { fields.push(`${col} = ?`); params.push(patch[k]); }
  }
  if (!fields.length) return;
  fields.push("updated_at = datetime('now')");
  params.push(taskId);
  await run(db, `UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`, params);
}

export async function finishTask(db, taskId, status, message = '') {
  await run(
    db,
    `UPDATE tasks SET status = ?, message = ?, finished_at = datetime('now'),
            duration_ms = CAST(ROUND((julianday('now') - julianday(started_at)) * 86400000) AS INTEGER),
            updated_at = datetime('now')
      WHERE id = ?`,
    [status, message, taskId],
  );
  if (status === 'success') {
    await run(db, 'UPDATE tasks SET progress = 100 WHERE id = ?', [taskId]);
  }
}

export async function listTasks(db, { page = 1, pageSize = 15, keyword = '', status = '', type = '', resourceType = '' } = {}) {
  const where = [];
  const params = [];
  if (keyword) {
    where.push('(task_no LIKE ? OR title LIKE ? OR message LIKE ?)');
    const like = `%${keyword}%`;
    params.push(like, like, like);
  }
  if (status) { where.push('status = ?'); params.push(status); }
  if (type) { where.push('type = ?'); params.push(type); }
  if (resourceType) { where.push('resource_type = ?'); params.push(resourceType); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const total = await count(db, `SELECT COUNT(*) FROM tasks ${whereSql}`, params);
  const list = await all(
    db,
    `SELECT t.*, sa.name AS source_account_name, ta.name AS target_account_name
       FROM tasks t
       LEFT JOIN cf_accounts sa ON sa.id = t.source_account
       LEFT JOIN cf_accounts ta ON ta.id = t.target_account
       ${whereSql}
      ORDER BY t.id DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  );
  return { total, list };
}

export async function getTask(db, id) {
  return one(
    db,
    `SELECT t.*, sa.name AS source_account_name, ta.name AS target_account_name
       FROM tasks t
       LEFT JOIN cf_accounts sa ON sa.id = t.source_account
       LEFT JOIN cf_accounts ta ON ta.id = t.target_account
      WHERE t.id = ?`,
    [id],
  );
}

/** 任务 DTO（log 解析成数组） */
export function taskDto(row) {
  if (!row) return null;
  let logs = [];
  try { logs = JSON.parse(row.log || '[]'); } catch { logs = []; }
  return {
    id: row.id,
    taskNo: row.task_no,
    type: row.type,
    resourceType: row.resource_type,
    title: row.title,
    sourceAccount: row.source_account,
    sourceAccountName: row.source_account_name || '',
    sourceResource: row.source_resource || '',
    targetAccount: row.target_account,
    targetAccountName: row.target_account_name || '',
    targetResource: row.target_resource || '',
    status: row.status,
    progress: row.progress,
    totalItems: row.total_items,
    doneItems: row.done_items,
    bytesTotal: row.bytes_total,
    bytesDone: row.bytes_done,
    message: row.message || '',
    logs,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    durationMs: row.duration_ms || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
