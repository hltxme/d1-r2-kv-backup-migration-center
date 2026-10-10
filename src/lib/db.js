/**
 * D1 数据库轻量封装 + 应用设置读写
 */
import { generateAppSecret } from './crypto.js';

/** 查询单行 */
export async function one(db, sql, params = []) {
  return db.prepare(sql).bind(...params).first();
}

/** 查询多行 */
export async function all(db, sql, params = []) {
  const res = await db.prepare(sql).bind(...params).all();
  return res?.results ?? [];
}

/** 写操作 */
export async function run(db, sql, params = []) {
  return db.prepare(sql).bind(...params).run();
}

/** 取 count(*) 之类的单值 */
export async function scalar(db, sql, params = []) {
  const row = await one(db, sql, params);
  if (!row) return null;
  const vals = Object.values(row);
  return vals.length ? vals[0] : null;
}

export async function count(db, sql, params = []) {
  const v = await scalar(db, sql, params);
  return Number(v ?? 0);
}

/** 批量执行（事务） */
export async function batch(db, statements) {
  return db.batch(
    statements.map(([sql, params = []]) => db.prepare(sql).bind(...params)),
  );
}

/** 构造 IN (...) 占位符 */
export function inParams(values) {
  return values.map(() => '?').join(',');
}

// ---------------------------------------------------------------------------
// settings 表
// ---------------------------------------------------------------------------

export async function getSetting(db, key, def = null) {
  try {
    const row = await one(db, 'SELECT value FROM settings WHERE key = ?', [key]);
    return row?.value ?? def;
  } catch {
    return def;
  }
}

export async function setSetting(db, key, value) {
  await run(
    db,
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    [key, String(value ?? '')],
  );
}

/**
 * 取得用于加密 CF Token 的密钥。
 * 优先级：env.APP_SECRET（推荐，wrangler secret） > settings 表随机生成的密钥
 */
export async function getAppSecret(db, env) {
  if (env.APP_SECRET && String(env.APP_SECRET).trim()) {
    return String(env.APP_SECRET).trim();
  }
  const existing = await getSetting(db, 'app_secret');
  if (existing) return existing;
  const generated = generateAppSecret();
  await setSetting(db, 'app_secret', generated);
  return generated;
}

/** 是否使用了自动生成的弱密钥（前端仪表盘给出安全提示） */
export async function isAutoSecret(db, env) {
  if (env.APP_SECRET && String(env.APP_SECRET).trim()) return false;
  const existing = await getSetting(db, 'app_secret');
  return Boolean(existing);
}
