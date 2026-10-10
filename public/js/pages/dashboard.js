/**
 * 仪表盘
 */
import { t } from '../i18n.js';
import { api } from '../api.js';
import {
  icon, escapeHtml, formatNumber, formatBytes, formatDate, timeAgo,
  emptyState, toastError, statusBadge,
} from '../ui.js';

function statCard({ iconName, chip, label, value, sub }) {
  return `
    <div class="stat-card">
      <div class="stat-head">
        <div class="stat-label">${escapeHtml(label)}</div>
        <div class="stat-icon icon-chip-${chip}">${icon(iconName, 17)}</div>
      </div>
      <div class="stat-value">${escapeHtml(value)}</div>
      ${sub ? `<div class="stat-sub">${sub}</div>` : ''}
    </div>`;
}

export async function renderDashboard({ container, navigate, refresh }) {
  const $ = (sel) => container.querySelector(sel);

  container.innerHTML = `
    <div class="empty" style="padding:80px 20px">
      <div class="spinner"></div>
      <div class="empty-title">${escapeHtml(t('common.loading'))}</div>
    </div>`;

  const data = await api('/api/dashboard/summary');
  const { stats, tasks, audit, security, server } = data;

  const totalSize = (stats.d1?.size || 0) + (stats.r2?.size || 0) + (stats.kv?.size || 0);

  container.innerHTML = `
    ${security?.autoSecret ? `
      <div class="notice notice-warning mb-4">
        ${icon('shield', 17)}
        <div>
          <b>${escapeHtml(t('dashboard.securityNotice'))}</b><br/>
          ${escapeHtml(t('dashboard.autoSecretWarn'))}
        </div>
      </div>` : ''}

    <div class="stat-grid">
      ${statCard({
        iconName: 'cloud', chip: 'indigo',
        label: t('dashboard.totalAccounts'),
        value: formatNumber(stats.accounts),
        sub: `${t('dashboard.sessionInfo', { n: security?.sessionTtlDays ?? 7 })}`,
      })}
      ${statCard({
        iconName: 'database', chip: 'blue',
        label: t('dashboard.totalD1'),
        value: formatNumber(stats.d1?.count),
        sub: `<b>${formatBytes(stats.d1?.size)}</b> · ${t('dashboard.rows')}`,
      })}
      ${statCard({
        iconName: 'bucket', chip: 'green',
        label: t('dashboard.totalR2'),
        value: formatNumber(stats.r2?.count),
        sub: `<b>${formatNumber(stats.r2?.objects)}</b> ${t('dashboard.objects')} · ${formatBytes(stats.r2?.size)}`,
      })}
      ${statCard({
        iconName: 'key', chip: 'amber',
        label: t('dashboard.totalKV'),
        value: formatNumber(stats.kv?.count),
        sub: `<b>${formatNumber(stats.kv?.keys)}</b> ${t('dashboard.keys')}`,
      })}
      ${statCard({
        iconName: 'layers', chip: 'slate',
        label: t('dashboard.totalSize'),
        value: formatBytes(totalSize),
        sub: `D1 + R2 + KV`,
      })}
      ${statCard({
        iconName: 'clock', chip: 'rose',
        label: t('tasks.title'),
        value: formatNumber(tasks.total),
        sub: `<b>${formatNumber(tasks.running)}</b> ${t('common.running')} · <b>${formatNumber(tasks.failed)}</b> ${t('common.failed')}`,
      })}
    </div>

    <div class="grid-2">
      <section class="card">
        <div class="card-header">
          <div>
            <div class="card-title">${icon('clock', 17)} ${escapeHtml(t('dashboard.recentTasks'))}</div>
            <div class="card-subtitle">${escapeHtml(t('tasks.desc'))}</div>
          </div>
          <button class="btn btn-secondary btn-sm" data-go="tasks">${escapeHtml(t('common.more'))}</button>
        </div>
        <div class="card-body" style="padding:6px 8px">
          ${tasks.recent.length ? `
            <div class="table-wrap" style="border:0">
              <table class="table" style="min-width:0">
                <thead>
                  <tr>
                    <th>${escapeHtml(t('tasks.taskNo'))}</th>
                    <th>${escapeHtml(t('common.type'))}</th>
                    <th>${escapeHtml(t('common.status'))}</th>
                    <th>${escapeHtml(t('common.time'))}</th>
                  </tr>
                </thead>
                <tbody>
                  ${tasks.recent.map((task) => `
                    <tr>
                      <td>
                        <div class="cell-strong truncate" style="max-width:220px" title="${escapeHtml(task.title)}">${escapeHtml(task.title)}</div>
                        <div class="text-xs text-muted font-mono">${escapeHtml(task.taskNo)}</div>
                      </td>
                      <td><span class="chip">${escapeHtml(t(`tasks.type${task.type ? task.type[0].toUpperCase() + task.type.slice(1) : 'Backup'}`))}</span></td>
                      <td>${statusBadge(task.status)}</td>
                      <td class="text-xs text-muted" title="${escapeHtml(formatDate(task.createdAt))}">${escapeHtml(timeAgo(task.createdAt))}</td>
                    </tr>`).join('')}
                </tbody>
              </table>
            </div>`
          : emptyState({ iconName: 'inbox', title: t('dashboard.noTasks') })}
        </div>
      </section>

      <section class="card">
        <div class="card-header">
          <div>
            <div class="card-title">${icon('activity', 17)} ${escapeHtml(t('dashboard.recentAudit'))}</div>
            <div class="card-subtitle">${escapeHtml(t('audit.desc'))}</div>
          </div>
          <button class="btn btn-secondary btn-sm" id="healthBtn">${icon('shield', 15)} ${escapeHtml(t('health.title'))}</button>
        </div>
        <div class="card-body" style="padding:6px 8px">
          ${audit.length ? `
            <div class="table-wrap" style="border:0">
              <table class="table" style="min-width:0">
                <thead>
                  <tr>
                    <th>${escapeHtml(t('common.user'))}</th>
                    <th>${escapeHtml(t('audit.action'))}</th>
                    <th>${escapeHtml(t('common.time'))}</th>
                  </tr>
                </thead>
                <tbody>
                  ${audit.map((log) => `
                    <tr>
                      <td class="cell-strong">${escapeHtml(log.username || '—')}</td>
                      <td>
                        <div class="truncate" style="max-width:220px">${escapeHtml(log.action)}</div>
                        <div class="text-xs text-muted truncate" style="max-width:220px">${escapeHtml(log.target || '')}</div>
                      </td>
                      <td class="text-xs text-muted" title="${escapeHtml(formatDate(log.created_at))}">${escapeHtml(timeAgo(log.created_at))}</td>
                    </tr>`).join('')}
                </tbody>
              </table>
            </div>`
          : emptyState({ iconName: 'activity', title: t('dashboard.noAudit') })}
        </div>
      </section>
    </div>

    <section class="card mt-4">
      <div class="card-header">
        <div>
          <div class="card-title">${icon('zap', 17)} ${escapeHtml(t('dashboard.quickActions'))}</div>
          <div class="card-subtitle">${escapeHtml(server.appName)} · v${escapeHtml(server.version)}</div>
        </div>
      </div>
      <div class="card-body flex gap-3 wrap">
        <button class="btn btn-primary" data-go="accounts">${icon('plus', 16)} ${escapeHtml(t('dashboard.addAccount'))}</button>
        <button class="btn btn-secondary" data-go="d1">${icon('database', 16)} ${escapeHtml(t('res.d1Title'))}</button>
        <button class="btn btn-secondary" data-go="r2">${icon('bucket', 16)} ${escapeHtml(t('res.r2Title'))}</button>
        <button class="btn btn-secondary" data-go="kv">${icon('key', 16)} ${escapeHtml(t('res.kvTitle'))}</button>
        <button class="btn btn-secondary" data-go="tasks">${icon('clock', 16)} ${escapeHtml(t('dashboard.viewTasks'))}</button>
      </div>
    </section>`;

  container.querySelectorAll('[data-go]').forEach((el) => {
    el.addEventListener('click', () => navigate(el.dataset.go));
  });

  $('#healthBtn')?.addEventListener('click', async () => {
    try {
      const res = await api('/api/health/detail');
      const { openModal } = await import('../ui.js');
      openModal({
        title: t('health.title'),
        body: `
          <div class="flex flex-col gap-2">
            ${res.checks.map((c) => `
              <div class="flex items-center gap-3" style="padding:11px 13px;border:1px solid var(--border);border-radius:var(--radius-md)">
                <span class="badge ${c.ok ? 'badge-success' : 'badge-danger'}">${escapeHtml(c.ok ? t('health.ok') : t('health.bad'))}</span>
                <div>
                  <div style="font-weight:600">${escapeHtml(c.name)}</div>
                  <div class="text-xs text-muted">${escapeHtml(c.detail)}</div>
                </div>
              </div>`).join('')}
          </div>`,
        footer: `<button class="btn btn-primary" data-close>${escapeHtml(t('common.close'))}</button>`,
      });
    } catch (e) {
      toastError(e.message);
    }
  });
}
