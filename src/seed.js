/**
 * 首次运行自动初始化：建表 + 创建默认管理员
 *
 * 说明：为降低部署门槛，Worker 会在第一次请求时自动执行建表与初始化。
 * 如果你更希望手动建表，可执行 `npm run db:init`（schema.sql），本文件会自动跳过。
 *
 * ⚠️ 请保持与根目录 schema.sql 的表结构一致。
 */
import { one, run, getSetting, setSetting } from './lib/db.js';
import { hashPassword } from './lib/crypto.js';

const SCHEMA_VERSION = '1';

const DDL = [
  `CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY, value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT, email TEXT, avatar TEXT, bio TEXT,
      locale TEXT NOT NULL DEFAULT 'zh-CN',
      theme TEXT NOT NULL DEFAULT 'light',
      accent TEXT NOT NULL DEFAULT 'indigo',
      role TEXT NOT NULL DEFAULT 'admin',
      status TEXT NOT NULL DEFAULT 'active',
      must_change_pwd INTEGER NOT NULL DEFAULT 0,
      last_login_at TEXT, last_login_ip TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      token_hint TEXT NOT NULL,
      ip TEXT, user_agent TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)`,
  `CREATE TABLE IF NOT EXISTS login_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL, ip TEXT,
      success INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE INDEX IF NOT EXISTS idx_attempts_user ON login_attempts(username, created_at)`,
  `CREATE TABLE IF NOT EXISTS cf_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      account_id TEXT NOT NULL,
      account_name TEXT,
      api_token TEXT NOT NULL,
      api_token_hint TEXT,
      r2_access_key_id TEXT,
      r2_secret_access_key TEXT,
      r2_endpoint TEXT,
      plan TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      color TEXT NOT NULL DEFAULT 'indigo',
      note TEXT,
      last_sync_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_cf_accounts_account ON cf_accounts(account_id)`,
  `CREATE TABLE IF NOT EXISTS d1_databases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      database_id TEXT NOT NULL,
      database_name TEXT NOT NULL,
      version TEXT, region TEXT, primary_location TEXT,
      num_tables INTEGER DEFAULT 0,
      file_size INTEGER DEFAULT 0,
      rows_count INTEGER DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      note TEXT, remote_created TEXT, last_sync_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_d1_unique ON d1_databases(account_id, database_id)`,
  `CREATE INDEX IF NOT EXISTS idx_d1_name ON d1_databases(database_name)`,
  `CREATE TABLE IF NOT EXISTS r2_buckets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      bucket_name TEXT NOT NULL,
      location TEXT, storage_class TEXT,
      object_count INTEGER DEFAULT 0,
      total_size INTEGER DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      note TEXT, remote_created TEXT, last_sync_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_r2_unique ON r2_buckets(account_id, bucket_name)`,
  `CREATE INDEX IF NOT EXISTS idx_r2_name ON r2_buckets(bucket_name)`,
  `CREATE TABLE IF NOT EXISTS kv_namespaces (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      namespace_id TEXT NOT NULL,
      title TEXT NOT NULL,
      region TEXT,
      key_count INTEGER DEFAULT 0,
      total_size INTEGER DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      note TEXT, remote_created TEXT, last_sync_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_kv_unique ON kv_namespaces(account_id, namespace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_kv_title ON kv_namespaces(title)`,
  `CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_no TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      title TEXT NOT NULL,
      source_account INTEGER, source_resource TEXT,
      target_account INTEGER, target_resource TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      progress INTEGER NOT NULL DEFAULT 0,
      total_items INTEGER NOT NULL DEFAULT 0,
      done_items INTEGER NOT NULL DEFAULT 0,
      bytes_total INTEGER NOT NULL DEFAULT 0,
      bytes_done INTEGER NOT NULL DEFAULT 0,
      message TEXT, log TEXT,
      started_at TEXT, finished_at TEXT,
      duration_ms INTEGER DEFAULT 0,
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_type ON tasks(type, resource_type)`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_time ON tasks(created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER, username TEXT,
      action TEXT NOT NULL, target TEXT, detail TEXT, ip TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_logs(created_at DESC)`,
];

let bootstrapped = false;

/** 幂等初始化：建表 + 默认管理员 */
export async function ensureBootstrap(db, env) {
  if (bootstrapped) return;

  // 1. 版本检查：只有版本不匹配时才执行建表，避免每次冷启动都跑 DDL
  let version = null;
  try {
    version = await getSetting(db, 'schema_version');
  } catch {
    version = null;
  }

  if (version !== SCHEMA_VERSION) {
    for (const sql of DDL) {
      try {
        await db.prepare(sql).run();
      } catch (e) {
        if (!/already exists/i.test(String(e?.message))) {
          console.error('[bootstrap] DDL 失败:', sql.slice(0, 60), e?.message);
        }
      }
    }
    await setSetting(db, 'schema_version', SCHEMA_VERSION);
  }

  // 2. 默认管理员
  const userCount = await one(db, 'SELECT COUNT(*) AS c FROM users');
  if (!userCount || Number(userCount.c) === 0) {
    const username = 'admin';
    const password = String(env.ADMIN_PASSWORD || '123456');
    const iterations = parseInt(env.PBKDF2_ITERATIONS || '120000', 10);
    const hash = await hashPassword(password, iterations);
    await run(
      db,
      `INSERT INTO users (username, password_hash, display_name, role, locale, theme, accent, must_change_pwd, created_at, updated_at)
       VALUES (?, ?, ?, 'admin', ?, ?, ?, 1, datetime('now'), datetime('now'))`,
      [
        username, hash, 'Administrator',
        env.APP_DEFAULT_LOCALE || 'zh-CN',
        env.APP_DEFAULT_THEME || 'light',
        env.APP_DEFAULT_ACCENT || 'indigo',
      ],
    );
    console.log('[bootstrap] 已创建默认管理员 admin（首次登录后请立即修改密码）');
  }

  bootstrapped = true;
}
