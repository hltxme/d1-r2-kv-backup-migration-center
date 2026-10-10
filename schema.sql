-- ============================================================================
--  Cloudflare D1 + R2 + KV 数据备份与跨账号迁移中心 · 元数据库结构
--  执行：npx wrangler d1 execute d1-r2-kv-center --remote --file=./schema.sql
-- ============================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- 应用设置（加密密钥、初始化标记等）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- 系统用户（登录帐密）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  username        TEXT    NOT NULL UNIQUE,
  password_hash   TEXT    NOT NULL,            -- pbkdf2$iterations$salt$hash
  display_name    TEXT,
  email           TEXT,
  avatar          TEXT,
  bio             TEXT,
  locale          TEXT    NOT NULL DEFAULT 'zh-CN',
  theme           TEXT    NOT NULL DEFAULT 'light',
  accent          TEXT    NOT NULL DEFAULT 'indigo',
  role            TEXT    NOT NULL DEFAULT 'admin',   -- admin | operator | viewer
  status          TEXT    NOT NULL DEFAULT 'active',  -- active | disabled
  must_change_pwd INTEGER NOT NULL DEFAULT 0,
  last_login_at   TEXT,
  last_login_ip   TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- 登录会话
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT    PRIMARY KEY,             -- token 的 sha256，绝不存明文
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hint  TEXT    NOT NULL,                -- token 前 8 位，便于排查
  ip          TEXT,
  user_agent  TEXT,
  expires_at  TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  last_seen   TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_user    ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- ---------------------------------------------------------------------------
-- 登录失败 / 风控
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS login_attempts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  username    TEXT NOT NULL,
  ip          TEXT,
  success     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_attempts_user ON login_attempts(username, created_at);

-- ---------------------------------------------------------------------------
-- Cloudflare 账号（跨账号迁移的“源 / 目标”）
-- api_token / r2_secret 采用 AES-GCM 加密存储
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cf_accounts (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  name                TEXT    NOT NULL,                 -- 业务别名，如「生产账号」
  account_id          TEXT    NOT NULL,                 -- Cloudflare Account ID
  account_name        TEXT,                             -- 同步下来的账号名
  api_token           TEXT    NOT NULL,                 -- AES-GCM 密文
  api_token_hint      TEXT,                             -- 明文前缀，便于识别
  r2_access_key_id    TEXT,
  r2_secret_access_key TEXT,                            -- AES-GCM 密文（可选，R2 对象级操作用）
  r2_endpoint         TEXT,                             -- 可选，默认 {account_id}.r2.cloudflarestorage.com
  plan                TEXT,
  status              TEXT    NOT NULL DEFAULT 'active', -- active | disabled
  color               TEXT    NOT NULL DEFAULT 'indigo',
  note                TEXT,
  last_sync_at        TEXT,
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cf_accounts_account ON cf_accounts(account_id);

-- ---------------------------------------------------------------------------
-- 资源清单：D1 数据库
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS d1_databases (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id      INTEGER NOT NULL REFERENCES cf_accounts(id) ON DELETE CASCADE,
  database_id     TEXT    NOT NULL,             -- Cloudflare D1 database uuid
  database_name   TEXT    NOT NULL,
  version         TEXT,
  region          TEXT,
  primary_location TEXT,
  num_tables      INTEGER DEFAULT 0,
  file_size       INTEGER DEFAULT 0,            -- bytes
  rows_count      INTEGER DEFAULT 0,
  status          TEXT    NOT NULL DEFAULT 'active',
  note            TEXT,
  remote_created  TEXT,
  last_sync_at    TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_d1_unique ON d1_databases(account_id, database_id);
CREATE INDEX IF NOT EXISTS idx_d1_name ON d1_databases(database_name);

-- ---------------------------------------------------------------------------
-- 资源清单：R2 存储桶
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS r2_buckets (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id      INTEGER NOT NULL REFERENCES cf_accounts(id) ON DELETE CASCADE,
  bucket_name     TEXT    NOT NULL,
  location        TEXT,
  storage_class   TEXT,
  object_count    INTEGER DEFAULT 0,
  total_size      INTEGER DEFAULT 0,            -- bytes
  status          TEXT    NOT NULL DEFAULT 'active',
  note            TEXT,
  remote_created  TEXT,
  last_sync_at    TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_r2_unique ON r2_buckets(account_id, bucket_name);
CREATE INDEX IF NOT EXISTS idx_r2_name ON r2_buckets(bucket_name);

-- ---------------------------------------------------------------------------
-- 资源清单：KV 命名空间
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kv_namespaces (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id      INTEGER NOT NULL REFERENCES cf_accounts(id) ON DELETE CASCADE,
  namespace_id    TEXT    NOT NULL,
  title           TEXT    NOT NULL,
  region          TEXT,
  key_count       INTEGER DEFAULT 0,
  total_size      INTEGER DEFAULT 0,
  status          TEXT    NOT NULL DEFAULT 'active',
  note            TEXT,
  remote_created  TEXT,
  last_sync_at    TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_kv_unique ON kv_namespaces(account_id, namespace_id);
CREATE INDEX IF NOT EXISTS idx_kv_title ON kv_namespaces(title);

-- ---------------------------------------------------------------------------
-- 备份 / 迁移任务流水
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tasks (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  task_no         TEXT    NOT NULL UNIQUE,       -- T-20250101-xxxx
  type            TEXT    NOT NULL,              -- backup | restore | migrate | sync | test
  resource_type   TEXT    NOT NULL,              -- d1 | r2 | kv
  title           TEXT    NOT NULL,
  source_account  INTEGER REFERENCES cf_accounts(id) ON DELETE SET NULL,
  source_resource TEXT,
  target_account  INTEGER REFERENCES cf_accounts(id) ON DELETE SET NULL,
  target_resource TEXT,
  status          TEXT    NOT NULL DEFAULT 'pending', -- pending | running | success | failed | cancelled
  progress        INTEGER NOT NULL DEFAULT 0,   -- 0-100
  total_items     INTEGER NOT NULL DEFAULT 0,
  done_items      INTEGER NOT NULL DEFAULT 0,
  bytes_total     INTEGER NOT NULL DEFAULT 0,
  bytes_done      INTEGER NOT NULL DEFAULT 0,
  message         TEXT,
  log             TEXT,                          -- JSON 数组，逐行日志
  started_at      TEXT,
  finished_at     TEXT,
  duration_ms     INTEGER DEFAULT 0,
  created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_type   ON tasks(type, resource_type);
CREATE INDEX IF NOT EXISTS idx_tasks_time   ON tasks(created_at DESC);

-- ---------------------------------------------------------------------------
-- 操作审计
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  username    TEXT,
  action      TEXT NOT NULL,
  target      TEXT,
  detail      TEXT,
  ip          TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_logs(created_at DESC);
