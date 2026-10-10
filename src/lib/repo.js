/**
 * 仓储层：CF 账号 / 资源清单 的读写与密钥解密
 */
import { decryptSecret, encryptSecret } from './crypto.js';
import { getAppSecret } from './db.js';
import { one, all, run, count, inParams } from './db.js';
import { CloudflareAPI } from '../cf/client.js';
import { R2S3 } from '../cf/s3.js';
import { err } from './http.js';

/** 对外暴露的账号字段（密钥脱敏） */
export function accountDto(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    accountId: row.accountId ?? row.account_id,
    accountName: row.accountName ?? row.account_name ?? '',
    apiTokenHint: row.apiTokenHint ?? row.api_token_hint ?? '',
    hasR2Key: Boolean(row.r2_access_key_id),
    r2AccessKeyId: row.r2_access_key_id || '',
    r2Endpoint: row.r2_endpoint || '',
    plan: row.plan || '',
    status: row.status,
    color: row.color || 'indigo',
    note: row.note || '',
    lastSyncAt: row.last_sync_at || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    // 聚合统计（由调用方按需补充）
    stats: row.stats || undefined,
  };
}

/** 解密得到可用的明文凭据 */
export async function accountSecrets(db, env, row) {
  const secret = await getAppSecret(db, env);
  return {
    apiToken: await decryptSecret(row.api_token, secret),
    r2SecretAccessKey: row.r2_secret_access_key
      ? await decryptSecret(row.r2_secret_access_key, secret)
      : '',
    r2AccessKeyId: row.r2_access_key_id || '',
    r2Endpoint: row.r2_endpoint || '',
  };
}

export async function getAccountById(db, id) {
  return one(db, 'SELECT * FROM cf_accounts WHERE id = ?', [id]);
}

export async function requireAccount(db, id) {
  const row = await getAccountById(db, id);
  if (!row) throw err.notFound('CF 账号不存在或已删除');
  return row;
}

/** 组装 Cloudflare REST 客户端 */
export async function buildCfApi(db, env, accountRow) {
  const { apiToken } = await accountSecrets(db, env, accountRow);
  return new CloudflareAPI({ accountId: accountRow.account_id, apiToken });
}

/** 组装 R2 S3 客户端（未配置 R2 Key 会抛出可读错误） */
export async function buildS3(db, env, accountRow) {
  const s = await accountSecrets(db, env, accountRow);
  return new R2S3({
    accountId: accountRow.account_id,
    accessKeyId: s.r2AccessKeyId,
    secretAccessKey: s.r2SecretAccessKey,
    endpoint: s.r2Endpoint,
  });
}

// ---------------------------------------------------------------------------
// 资源统计
// ---------------------------------------------------------------------------

const RESOURCE_TABLES = {
  d1: { table: 'd1_databases', nameCol: 'database_name' },
  r2: { table: 'r2_buckets', nameCol: 'bucket_name' },
  kv: { table: 'kv_namespaces', nameCol: 'title' },
};

export async function resourceStats(db) {
  const [accounts, d1, r2, kv] = await Promise.all([
    count(db, 'SELECT COUNT(*) FROM cf_accounts'),
    count(db, 'SELECT COUNT(*) FROM d1_databases'),
    count(db, 'SELECT COUNT(*) FROM r2_buckets'),
    count(db, 'SELECT COUNT(*) FROM kv_namespaces'),
  ]);
  const [d1Size, r2Size, r2Objects, kvKeys] = await Promise.all([
    count(db, 'SELECT COALESCE(SUM(file_size),0) FROM d1_databases'),
    count(db, 'SELECT COALESCE(SUM(total_size),0) FROM r2_buckets'),
    count(db, 'SELECT COALESCE(SUM(object_count),0) FROM r2_buckets'),
    count(db, 'SELECT COALESCE(SUM(key_count),0) FROM kv_namespaces'),
  ]);
  return {
    accounts,
    d1: { count: d1, size: d1Size },
    r2: { count: r2, size: r2Size, objects: r2Objects },
    kv: { count: kv, keys: kvKeys },
  };
}

/** 为账号行附加本地资源数量 */
export async function attachAccountStats(db, rows) {
  if (!rows.length) return rows;
  const ids = rows.map((r) => r.id);
  const ph = inParams(ids);
  const [d1, r2, kv] = await Promise.all([
    all(db, `SELECT account_id, COUNT(*) c FROM d1_databases WHERE account_id IN (${ph}) GROUP BY account_id`, ids),
    all(db, `SELECT account_id, COUNT(*) c FROM r2_buckets WHERE account_id IN (${ph}) GROUP BY account_id`, ids),
    all(db, `SELECT account_id, COUNT(*) c FROM kv_namespaces WHERE account_id IN (${ph}) GROUP BY account_id`, ids),
  ]);
  const map = (list) => Object.fromEntries(list.map((r) => [r.account_id, r.c]));
  const m1 = map(d1); const m2 = map(r2); const m3 = map(kv);
  return rows.map((r) => ({
    ...r,
    stats: { d1: m1[r.id] || 0, r2: m2[r.id] || 0, kv: m3[r.id] || 0 },
  }));
}

export { RESOURCE_TABLES };
