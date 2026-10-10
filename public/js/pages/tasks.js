/**
 * 任务记录（备份 / 恢复 / 迁移）
 */
import { t } from '../i18n.js';
import { api, post } from '../api.js';
import {
  icon, escapeHtml, formatNumber, formatDate, formatDuration, timeAgo, pagination,
  emptyState, toastSuccess, toastError, openModal, confirmDialog, debounce, statusBadge,
} from '../ui.js';

const TYPE_LABEL = {
  backup: 'tasks.typeBackup',
  restore: 'tasks.typeRestore',
  migrate: 'tasks.typeMigrate',
  sync: 'tasks.typeSync',
  test: 'tasks.typeTest',
};

const RES_LABEL = { d1: 'D1', r2: 'R2', kv: 'KV' };

export async function renderTasks({ container, refresh }) {
  const $ = (sel) => container.querySelector(sel);
  const state = { keyword: '', status: '', type: '', page: 1, pageSize: 15, selected: new Set() };

  container.innerHTML = `
    <div class="toolbar">
      <div class="input-group search">
        <span class="input-icon">${icon('search', 16)}</span>
        <input class="input" id="kwInput" data-i18n-placeholder="common.searchPlaceholder"
               placeholder="${escapeHtml(t('common.searchPlaceholder'))}" />
      </div>
      <select class="select" id="typeFilter" style="width:130px">
        <option value="">${escapeHtml(t('common.type'))}</option>
        ${Object.entries(TYPE_LABEL).map(([k, v]) => `<option value="${k}">${escapeHtml(t(v))}</option>`).join('')}
      </select>
      <select class="select" id="statusFilter" style="width:130px">
        <option value="">${escapeHtml(t('common.all'))}</option>
        <option value="success">${escapeHtml(t('common.success'))}</option>
        <option value="failed">${escapeHtml(t('common.failed'))}</option>
        <option value="running">${escapeHtml(t('common.running'))}</option>
        <option value="pending">${escapeHtml(t('common.pending'))}</option>
      </select>
      <button class="btn btn-secondary btn-sm" id="refreshBtn">${icon('refresh', 15)} ${escapeHtml(t('common.refresh'))}</button>
      <div class="spacer"></div>
      <button class="btn btn-danger-ghost btn-sm" id="batchDelBtn" disabled>${icon('trash', 15)} ${escapeHtml(t('common.batchDelete'))} (<span id="selCount">0</span>)</button>
    </div>

    <div id="tableBox"></div>`;

  async function load() {
    const box = $('#tableBox');
    box.innerHTML = `<div class="empty"><div class="spinner"></div><div class="empty-title">${escapeHtml(t('common.loading'))}</div></div>`;
    try {
      const params = new URLSearchParams({ page: String(state.page), pageSize: String(state.pageSize) });
      if (state.keyword) params.set('keyword', state.keyword);
      if (state.status) params.set('status', state.status);
      if (state.type) params.set('type', state.type);
      const res = await api(`/api/tasks?${params}`);
      renderTable(res);
    } catch (e) {
      box.innerHTML = emptyState({ iconName: 'alert', title: t('common.loadFailed'), desc: e.message });
    }
  }

  function renderTable(res) {
    const list = res.list || [];
    const box = $('#tableBox');
    if (!list.length) {
      box.innerHTML = `<div class="card">${emptyState({ iconName: 'clock', title: t('dashboard.noTasks'), desc: t('common.noDataDesc') })}</div>`;
      return;
    }

    box.innerHTML = `
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th class="col-check"><input type="checkbox" class="checkbox" id="checkAll" /></th>
              <th>${escapeHtml(t('tasks.taskNo'))}</th>
              <th>${escapeHtml(t('common.type'))}</th>
              <th>${escapeHtml(t('tasks.source'))} → ${escapeHtml(t('tasks.target'))}</th>
              <th>${escapeHtml(t('tasks.progress'))}</th>
              <th>${escapeHtml(t('common.status'))}</th>
              <th>${escapeHtml(t('common.time'))}</th>
              <th class="col-actions">${escapeHtml(t('common.actions'))}</th>
            </tr>
          </thead>
          <tbody>
            ${list.map((row) => `
              <tr data-id="${row.id}" class="${state.selected.has(row.id) ? 'selected' : ''}">
                <td class="col-check"><input type="checkbox" class="checkbox row-check" data-id="${row.id}" ${state.selected.has(row.id) ? 'checked' : ''} /></td>
                <td>
                  <div class="cell-strong truncate" style="max-width:230px" title="${escapeHtml(row.title)}">${escapeHtml(row.title)}</div>
                  <div class="text-xs text-muted font-mono">${escapeHtml(row.taskNo)}</div>
                </td>
                <td>
                  <div class="flex gap-1 wrap">
                    <span class="badge badge-primary">${escapeHtml(t(TYPE_LABEL[row.type] || row.type))}</span>
                    <span class="badge">${escapeHtml(RES_LABEL[row.resourceType] || row.resourceType)}</span>
                  </div>
                </td>
                <td>
                  <div class="text-xs">${escapeHtml(row.sourceAccountName || '—')}</div>
                  <div class="text-xs text-muted truncate" style="max-width:190px">${escapeHtml(row.sourceResource || '')}</div>
                  <div class="text-xs mt-1">${escapeHtml(row.targetAccountName || '—')}</div>
                  <div class="text-xs text-muted truncate" style="max-width:190px">${escapeHtml(row.targetResource || '')}</div>
                </td>
                <td style="min-width:120px">
                  <div class="progress ${row.status === 'success' ? 'success' : row.status === 'failed' ? 'danger' : ''}">
                    <div class="bar" style="width:${Math.min(100, Number(row.progress || 0))}%"></div>
                  </div>
                  <div class="text-xs text-muted mt-1">${formatNumber(row.doneItems)} / ${formatNumber(row.totalItems)} · ${row.progress}%</div>
                </td>
                <td>${statusBadge(row.status)}</td>
                <td>
                  <div class="text-xs">${escapeHtml(formatDate(row.createdAt))}</div>
                  <div class="text-xs text-muted">${escapeHtml(formatDuration(row.durationMs))}</div>
                </td>
                <td>
                  <div class="cell-actions">
                    <button class="btn btn-sm btn-secondary" data-action="log" data-id="${row.id}" title="${escapeHtml(t('tasks.viewLog'))}">${icon('file', 14)}</button>
                    <button class="btn btn-sm btn-danger-ghost" data-action="delete" data-id="${row.id}" title="${escapeHtml(t('common.delete'))}">${icon('trash', 14)}</button>
                  </div>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      ${pagination(res.pagination)}`;

    $('#checkAll')?.addEventListener('change', (e) => {
      list.forEach((r) => (e.target.checked ? state.selected.add(r.id) : state.selected.delete(r.id)));
      container.querySelectorAll('.row-check').forEach((c) => { c.checked = e.target.checked; });
      container.querySelectorAll('tbody tr').forEach((tr) => tr.classList.toggle('selected', e.target.checked));
      updateSelCount();
    });
    container.querySelectorAll('.row-check').forEach((chk) => {
      chk.addEventListener('change', () => {
        const id = Number(chk.dataset.id);
        if (chk.checked) state.selected.add(id); else state.selected.delete(id);
        chk.closest('tr').classList.toggle('selected', chk.checked);
        updateSelCount();
      });
    });
    container.querySelectorAll('[data-page]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const p = Number(btn.dataset.page);
        if (p >= 1) { state.page = p; load(); }
      });
    });
    container.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', () => handleAction(btn.dataset.action, Number(btn.dataset.id)));
    });
  }

  function updateSelCount() {
    $('#selCount').textContent = String(state.selected.size);
    $('#batchDelBtn').disabled = state.selected.size === 0;
  }

  async function handleAction(action, id) {
    if (action === 'delete') {
      const ok = await confirmDialog({ title: t('common.confirmDeleteTitle'), desc: t('common.confirmDeleteDesc') });
      if (!ok) return;
      try {
        await post('/api/tasks/batch-delete', { ids: [id] });
        toastSuccess(t('common.deleteSuccess'));
        load();
      } catch (e) { toastError(e.message); }
      return;
    }
    if (action === 'log') {
      const modal = openModal({
        title: t('tasks.logs'),
        size: 'wide',
        body: `<div class="empty"><div class="spinner"></div><div class="empty-title">${escapeHtml(t('common.loading'))}</div></div>`,
      });
      try {
        const res = await api(`/api/tasks/${id}`);
        const task = res.task;
        modal.body.innerHTML = `
          <dl class="desc-list mb-4">
            <dt>${escapeHtml(t('tasks.taskNo'))}</dt><dd class="font-mono">${escapeHtml(task.taskNo)}</dd>
            <dt>${escapeHtml(t('common.type'))}</dt><dd>${escapeHtml(t(TYPE_LABEL[task.type] || task.type))} · ${escapeHtml(RES_LABEL[task.resourceType] || task.resourceType)}</dd>
            <dt>${escapeHtml(t('tasks.source'))}</dt><dd>${escapeHtml(task.sourceAccountName || '—')} · ${escapeHtml(task.sourceResource || '')}</dd>
            <dt>${escapeHtml(t('tasks.target'))}</dt><dd>${escapeHtml(task.targetAccountName || '—')} · ${escapeHtml(task.targetResource || '')}</dd>
            <dt>${escapeHtml(t('common.status'))}</dt><dd>${statusBadge(task.status)} ${task.message ? `· ${escapeHtml(task.message)}` : ''}</dd>
            <dt>${escapeHtml(t('tasks.duration'))}</dt><dd>${escapeHtml(formatDuration(task.durationMs))}</dd>
          </dl>
          <div class="field-label">${escapeHtml(t('tasks.logs'))}</div>
          <div class="log-box">${escapeHtml((task.logs || []).join('\n') || '—')}</div>`;
      } catch (e) {
        modal.body.innerHTML = emptyState({ iconName: 'alert', title: t('common.loadFailed'), desc: e.message });
      }
    }
  }

  $('#kwInput').addEventListener('input', debounce((e) => {
    state.keyword = e.target.value.trim();
    state.page = 1;
    load();
  }, 320));
  $('#typeFilter').addEventListener('change', (e) => { state.type = e.target.value; state.page = 1; load(); });
  $('#statusFilter').addEventListener('change', (e) => { state.status = e.target.value; state.page = 1; load(); });
  $('#refreshBtn').addEventListener('click', load);
  $('#batchDelBtn').addEventListener('click', async () => {
    const ids = [...state.selected];
    if (!ids.length) return;
    const ok = await confirmDialog({
      title: t('common.batchDeleteTitle'),
      desc: t('common.batchDeleteDesc', { n: ids.length }),
    });
    if (!ok) return;
    try {
      await post('/api/tasks/batch-delete', { ids });
      toastSuccess(t('common.deleteSuccess'));
      state.selected.clear();
      updateSelCount();
      load();
    } catch (e) { toastError(e.message); }
  });

  await load();
}
