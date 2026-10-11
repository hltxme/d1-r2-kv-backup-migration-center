/**
 * 备份 / 恢复 / 跨账号迁移 引擎
 *
 * - D1：整库 dump（表结构 + 数据）→ 目标账号 D1 建表并写入
 * - KV：全量 key/value（含元数据）→ 目标命名空间批量写入
 * - R2：对象逐个流式复制（GET → PUT，走 S3 兼容 API）
 *
 * 所有操作都在一个 HTTP 请求内同步完成，并把进度写入 tasks 表。
 * 大数据量请分批执行（Workers 有 CPU 时间限制）。
 */
import { taskLog, updateTask, finishTask } from './tasks.js';
import { R2S3 } from '../cf/s3.js';

/**
 * 把行数据转成 SQL 字面量（避免绑定参数，单条语句可写入数百行）
 * - number / bigint / boolean → 原生字面量
 * - 字节数组 → X'..' blob 字面量
 * - 其余 → 单引号字符串（'' 转义）
 */
function sqlLiteral(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'bigint') return String(v);
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (Array.isArray(v)) {
    const hex = v.map((b) => Number(b & 0xff).toString(16).padStart(2, '0')).join('');
    return hex ? `X'${hex}'` : "X''";
  }
  return `'${String(v).replace(/'/g, "''")}'`;
}

// 单条 SQL 语句上限 100KB（D1 限制），按字符数保守预估（多字节字符最多 3 字节/字符）
const MAX_LITERAL_CHARS = 30000;
// 超长行字面量回退为单行参数化插入（参数化语句体积极小，可插入 2MB 级行）
const HUGE_ROW_CHARS = 90000;

/** 把 Workers 资源限额错误翻译成可操作的提示 */
function friendlyLimitError(e) {
  const msg = String(e?.message || e);
  if (/Too many subrequests|CPU time limit|exceeded CPU|Error 1102/i.test(msg)) {
    return new Error(
      '本次迁移数据量超出 Workers 单次请求的资源限额（免费版每次请求最多 50 次外部调用 / 10ms CPU，'
      + '付费版 1000 次调用）。已写入目标库的数据不会丢失且重跑不会产生重复，但大库建议：'
      + '1) 升级 Workers Paid 后一次跑完；或 2) 在控制台拆成多次迁移（每次迁部分表）。'
      + `原始错误：${msg}`,
    );
  }
  return e;
}

/**
 * 字面量多行写入（不受 100 绑定参数限制，单条语句可写入数百行）
 * @returns {Promise<{inserted: number, writeCalls: number}>}
 */
async function writeRowsLiteral(api, databaseId, safeName, columns, rows, onFlush = null) {
  const colSql = columns.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',');
  let inserted = 0;
  let writeCalls = 0;
  let stmt = `INSERT OR REPLACE INTO "${safeName}" (${colSql}) VALUES `;
  let stmtRows = [];
  const flush = async () => {
    if (!stmtRows.length) return;
    const n = stmtRows.length;
    await api.d1Query(databaseId, stmt + stmtRows.join(','));
    writeCalls += 1;
    inserted += n;
    stmtRows = [];
    stmt = `INSERT OR REPLACE INTO "${safeName}" (${colSql}) VALUES `;
    if (onFlush) await onFlush(n);
  };

  for (const row of rows) {
    const tuple = `(${columns.map((c) => sqlLiteral(row[c])).join(',')})`;
    if (tuple.length > HUGE_ROW_CHARS) {
      // 超长行：参数化单行插入（语句体积极小，可插入 2MB 行）
      await flush();
      await api.d1Query(
        databaseId,
        `INSERT OR REPLACE INTO "${safeName}" (${colSql}) VALUES (${columns.map(() => '?').join(',')})`,
        columns.map((c) => (row[c] === undefined ? null : row[c])),
      );
      writeCalls += 1;
      inserted += 1;
      if (onFlush) await onFlush(1);
      continue;
    }
    if (stmtRows.length && stmt.length + tuple.length > MAX_LITERAL_CHARS) await flush();
    stmtRows.push(tuple);
  }
  await flush();
  return { inserted, writeCalls };
}

/** 把 dump 写入目标 D1 */
export async function restoreD1(api, databaseId, dump, { runner = null, dropExisting = false } = {}) {
  let created = 0;
  let inserted = 0;
  let writeCalls = 0;

  try {
  for (const table of dump.tables || []) {
    const safeName = String(table.name).replace(/[^A-Za-z0-9_]/g, '');
    // 尽量关闭外键约束，避免 OR REPLACE 的删插顺序触碰外键校验（不支持的后端忽略）
    await api.d1Query(databaseId, 'PRAGMA foreign_keys = OFF').catch(() => {});
    if (dropExisting) {
      await api.d1Query(databaseId, `DROP TABLE IF EXISTS "${safeName}"`).catch(() => {});
    }
    if (table.sql) {
      try {
        await api.d1Query(databaseId, table.sql);
        created += 1;
      } catch (e) {
        if (!/already exists/i.test(String(e.message))) {
          throw new Error(`建表 ${table.name} 失败：${e.message}`);
        }
      }
    }

    const columns = table.columns?.length
      ? table.columns
      : (table.rows?.[0] ? Object.keys(table.rows[0]) : []);
    if (!columns.length) continue;
    const colSql = columns.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',');
    const rows = table.rows || [];

    const res = await writeRowsLiteral(api, databaseId, safeName, columns, rows, async (n) => {
      if (runner) { runner.done += n; await runner.flush(); }
    });
    inserted += res.inserted;
    writeCalls += res.writeCalls;
    if (runner) await runner.log(`写入表 ${table.name}：${rows.length} 行（${res.writeCalls} 次写入请求）`);
  }
  } catch (e) {
    throw friendlyLimitError(e);
  }
  return { created, inserted, writeCalls };
}

class Runner {
  constructor(db, taskId) {
    this.db = db;
    this.taskId = taskId;
    this.done = 0;
    this.total = 0;
    this.bytesDone = 0;
    this.bytesTotal = 0;
    this.lastFlush = 0;
  }

  async log(line) {
    await taskLog(this.db, this.taskId, line);
  }

  async flush(force = false) {
    const now = Date.now();
    if (!force && now - this.lastFlush < 500) return;
    this.lastFlush = now;
    const progress = this.total > 0 ? Math.min(99, Math.round((this.done / this.total) * 100)) : 0;
    await updateTask(this.db, this.taskId, {
      progress,
      doneItems: this.done,
      totalItems: this.total,
      bytesDone: this.bytesDone,
      bytesTotal: this.bytesTotal,
    });
  }
}

// ===========================================================================
// D1
// ===========================================================================

/** 读取远端 D1 的完整结构与数据 */
export async function dumpD1(api, databaseId, { maxRowsPerTable = 50000, runner = null } = {}) {
  const master = await api.d1Query(
    databaseId,
    `SELECT name, sql FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'
      ORDER BY name`,
  );
  const tables = [];
  for (const t of master.results || []) {
    const safeName = String(t.name).replace(/[^A-Za-z0-9_]/g, '');
    const info = await api.d1Query(databaseId, `PRAGMA table_info("${safeName}")`);
    const columns = (info.results || []).map((c) => c.name);
    const rows = await api.d1ScanAll(databaseId, safeName, { pageSize: 1000, maxRows: maxRowsPerTable });
    tables.push({ name: t.name, sql: t.sql, columns, rows });
    if (runner) {
      runner.total += rows.length;
      await runner.log(`读取表 ${t.name}：${rows.length} 行`);
      await runner.flush();
    }
  }
  return { version: 1, exportedAt: new Date().toISOString(), tables };
}

/** 跨账号迁移 D1 */
export async function migrateD1({ sourceApi, sourceDbId, targetApi, targetDbId, maxRowsPerTable = 50000, runner = null }) {
  const dump = await dumpD1(sourceApi, sourceDbId, { maxRowsPerTable, runner }).catch((e) => { throw friendlyLimitError(e); });
  if (runner) {
    runner.total = dump.tables.reduce((s, t) => s + t.rows.length, 0);
    await runner.log(`源库导出完成，共 ${dump.tables.length} 张表 / ${runner.total} 行，开始写入目标库`);
    await runner.flush(true);
  }
  const result = await restoreD1(targetApi, targetDbId, dump, { runner });
  return { tables: dump.tables.length, rows: dump.tables.reduce((s, t) => s + t.rows.length, 0), ...result };
}

// ===========================================================================
// D1 分批续传引擎（每次请求处理一小批，规避 Workers 单次请求资源限额）
// ===========================================================================

/** 初始化迁移状态：拉取表清单与列信息（不读数据） */
export async function migrateD1Init({ sourceApi, sourceDbId }) {
  const master = await sourceApi.d1Query(
    sourceDbId,
    `SELECT name, sql FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'
      ORDER BY name`,
  );
  const tables = [];
  for (const t of master.results || []) {
    const safeName = String(t.name).replace(/[^A-Za-z0-9_]/g, '');
    const info = await sourceApi.d1Query(sourceDbId, `PRAGMA table_info("${safeName}")`);
    const columns = (info.results || []).map((c) => c.name);
    let rowsTotal = 0;
    try {
      const cnt = await sourceApi.d1Query(sourceDbId, `SELECT COUNT(*) AS n FROM "${safeName}"`);
      rowsTotal = Number(cnt.results?.[0]?.n || 0);
    } catch { /* 忽略 */ }
    tables.push({ name: t.name, sql: t.sql, columns, rowsTotal, created: false });
  }
  return {
    version: 2,
    tables,
    tableIndex: 0,
    cursor: 0,
    cursorMode: 'rowid',      // rowid 游标；无 rowid 表退化为 offset 游标
    rowsDone: 0,
    rowsTotal: tables.reduce((s, t) => s + (t.rowsTotal || 0), 0),
    writeCalls: 0,
    startedAt: new Date().toISOString(),
  };
}

/**
 * 执行一步迁移：读一小批 → 写入目标库 → 推进游标
 * @param maxCalls 本步最多消耗的 API 调用次数（含读写）
 * @returns {{state: object, done: boolean, calls: number, rowsStep: number}}
 */
export async function migrateD1Step({
  sourceApi, sourceDbId, targetApi, targetDbId, state,
  chunkRows = 500, maxCalls = 12,
}) {
  let calls = 0;
  let rowsStep = 0;
  const tables = state.tables || [];

  try {
    while (state.tableIndex < tables.length) {
      const table = tables[state.tableIndex];
      const safeName = String(table.name).replace(/[^A-Za-z0-9_]/g, '');

      if (!table.created) {
        await targetApi.d1Query(targetDbId, 'PRAGMA foreign_keys = OFF').catch(() => {});
        calls += 1;
        if (table.sql) {
          try {
            await targetApi.d1Query(targetDbId, table.sql);
            calls += 1;
          } catch (e) {
            calls += 1;
            if (!/already exists/i.test(String(e.message))) throw e;
          }
        }
        table.created = true;
      }

      let rows = [];
      try {
        const page = state.cursorMode === 'rowid'
          ? await sourceApi.d1Query(
            sourceDbId,
            `SELECT rowid AS __rowid, * FROM "${safeName}" WHERE rowid > ? ORDER BY rowid LIMIT ?`,
            [state.cursor, chunkRows],
          )
          : await sourceApi.d1Query(
            sourceDbId,
            `SELECT * FROM "${safeName}" LIMIT ? OFFSET ?`,
            [chunkRows, state.cursor],
          );
        calls += 1;
        rows = page.results || [];
      } catch (e) {
        // WITHOUT ROWID 等表没有 rowid，退化为 offset 游标
        if (state.cursorMode === 'rowid' && /no such column|ORDER BY/i.test(String(e?.message || e))) {
          state.cursorMode = 'offset';
          state.cursor = 0;
          continue;
        }
        throw e;
      }

      if (!rows.length) {
        state.tableIndex += 1;
        state.cursor = 0;
        state.cursorMode = 'rowid';
        continue;
      }

      const columns = table.columns?.length
        ? table.columns
        : Object.keys(rows[0]).filter((k) => k !== '__rowid');
      const res = await writeRowsLiteral(targetApi, targetDbId, safeName, columns, rows);
      calls += res.writeCalls;
      state.writeCalls += res.writeCalls;
      state.rowsDone += rows.length;
      rowsStep += rows.length;

      if (state.cursorMode === 'rowid') {
        state.cursor = Number(rows[rows.length - 1].__rowid ?? (state.cursor + rows.length));
      } else {
        state.cursor += rows.length;
      }

      if (calls >= maxCalls) break;
    }
  } catch (e) {
    throw friendlyLimitError(e);
  }

  return { state, done: state.tableIndex >= tables.length, calls, rowsStep };
}

// ===========================================================================
// KV
// ===========================================================================

/** 导出 KV 全量键值 */
export async function dumpKV(api, nsId, { maxKeys = 20000, runner = null } = {}) {
  const keys = await api.getAllKvKeys(nsId, { maxKeys });
  const entries = [];
  let totalBytes = 0;
  for (const k of keys) {
    const res = await api.getKvValue(nsId, k.name);
    const value = await res.text();
    const bytes = new TextEncoder().encode(value).length;
    totalBytes += bytes;
    entries.push({
      key: k.name,
      value,
      expiration: k.expiration || undefined,
      metadata: k.metadata || undefined,
      base64: false,
    });
    if (runner) {
      runner.done += 1;
      runner.bytesDone += bytes;
      await runner.flush();
    }
  }
  if (runner) {
    runner.total = keys.length;
    runner.bytesTotal = totalBytes;
    await runner.log(`KV 导出完成：${entries.length} 个键，共 ${totalBytes} 字节`);
    await runner.flush(true);
  }
  return { version: 1, exportedAt: new Date().toISOString(), namespaceId: nsId, entries, totalBytes };
}

/** 批量写入 KV */
export async function restoreKV(api, nsId, entries, { runner = null, batchSize = 500 } = {}) {
  let written = 0;
  for (let i = 0; i < entries.length; i += batchSize) {
    const chunk = entries.slice(i, i + batchSize).map((e) => ({
      key: e.key,
      value: e.value,
      base64: Boolean(e.base64),
      expiration: e.expiration || undefined,
      expiration_ttl: e.expiration_ttl || undefined,
      metadata: e.metadata || undefined,
    }));
    await api.putKvBulk(nsId, chunk);
    written += chunk.length;
    if (runner) {
      runner.done += chunk.length;
      await runner.flush();
    }
  }
  return { written };
}

/** 跨账号迁移 KV */
export async function migrateKV({ sourceApi, sourceNsId, targetApi, targetNsId, maxKeys = 20000, runner = null }) {
  const dump = await dumpKV(sourceApi, sourceNsId, { maxKeys, runner });
  if (runner) {
    runner.total = dump.entries.length;
    await runner.log(`开始写入目标命名空间 ${targetNsId}`);
    await runner.flush(true);
  }
  const result = await restoreKV(targetApi, targetNsId, dump.entries, { runner });
  return { keys: dump.entries.length, totalBytes: dump.totalBytes, ...result };
}

// ===========================================================================
// R2
// ===========================================================================

/**
 * R2 跨账号/跨桶复制（流式，不落盘）
 * @param {{sourceS3: R2S3, sourceBucket: string, targetS3: R2S3, targetBucket: string, prefix?: string, maxObjects?: number, runner?: Runner}} opts
 */
export async function migrateR2({ sourceS3, sourceBucket, targetS3, targetBucket, prefix = '', maxObjects = 5000, runner = null }) {
  const objects = await sourceS3.listAllObjects(sourceBucket, { prefix, maxKeys: maxObjects });
  if (runner) {
    runner.total = objects.length;
    runner.bytesTotal = objects.reduce((s, o) => s + (o.size || 0), 0);
    await runner.log(`源桶 ${sourceBucket} 列出 ${objects.length} 个对象，开始复制到 ${targetBucket}`);
    await runner.flush(true);
  }

  let copied = 0;
  let skipped = 0;
  let failed = 0;
  const errors = [];

  for (const obj of objects) {
    try {
      const res = await sourceS3.getObjectResponse(sourceBucket, obj.key);
      if (!res.ok) throw new Error(`读取失败 HTTP ${res.status}`);
      const headers = {
        'content-type': res.headers.get('content-type') || 'application/octet-stream',
      };
      const cacheControl = res.headers.get('cache-control');
      const contentEncoding = res.headers.get('content-encoding');
      const metadata = {};
      for (const [k, v] of res.headers.entries()) {
        if (k.startsWith('x-amz-meta-')) metadata[k.slice('x-amz-meta-'.length)] = v;
      }

      await targetS3.putObject(targetBucket, obj.key, res.body, {
        contentType: headers['content-type'],
        cacheControl,
        contentEncoding,
        metadata,
      });
      copied += 1;
    } catch (e) {
      failed += 1;
      if (errors.length < 20) errors.push(`${obj.key}: ${e.message}`);
    }
    if (runner) {
      runner.done += 1;
      runner.bytesDone += obj.size || 0;
      await runner.flush();
    }
    if (copied + failed + skipped > maxObjects) break;
  }

  if (runner) {
    await runner.log(`R2 复制完成：成功 ${copied} / 失败 ${failed} / 跳过 ${skipped}`);
    if (errors.length) await runner.log(`失败明细（最多 20 条）：${errors.join(' | ')}`);
    await runner.flush(true);
  }
  return { total: objects.length, copied, skipped, failed, errors };
}

// ===========================================================================
// 导出为文件
// ===========================================================================

export function dumpToSql(dump) {
  const lines = [
    '-- Cloudflare D1 备份导出',
    `-- 导出时间：${dump.exportedAt}`,
    'PRAGMA foreign_keys = OFF;',
    'BEGIN TRANSACTION;',
  ];
  for (const table of dump.tables || []) {
    const safeName = String(table.name).replace(/[^A-Za-z0-9_]/g, '');
    lines.push('', `-- 表：${table.name}`, `DROP TABLE IF EXISTS "${safeName}";`);
    if (table.sql) lines.push(`${table.sql};`);
    const columns = table.columns || [];
    if (!columns.length || !table.rows?.length) continue;
    const colSql = columns.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',');
    for (const row of table.rows) {
      const values = columns.map((c) => {
        const v = row[c];
        if (v === null || v === undefined) return 'NULL';
        if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
        return `'${String(v).replace(/'/g, "''")}'`;
      }).join(',');
      lines.push(`INSERT INTO "${safeName}" (${colSql}) VALUES (${values});`);
    }
  }
  lines.push('COMMIT;', '');
  return lines.join('\n');
}
