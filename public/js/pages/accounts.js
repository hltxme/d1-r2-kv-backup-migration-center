/**
 * CF 账号管理
 */
import { t } from '../i18n.js';
import { api, del, post, put } from '../api.js';
import {
  icon, escapeHtml, formatNumber, formatDate, timeAgo, pagination, emptyState,
  toastSuccess, toastError, openModal, confirmDialog, debounce, statusBadge, copyText,
} from '../ui.js';

const COLORS = ['indigo', 'blue', 'cyan', 'teal', 'green', 'amber', 'orange', 'rose', 'violet', 'slate'];

export async function renderAccounts({ container, refresh }) {
  const $ = (sel) => container.querySelector(sel);
  const state = { keyword: '', status: '', page: 1, pageSize: 15, selected: new Set() };

  container.innerHTML = `
    <div class="toolbar">
      <div class="input-group search">
        <span class="input-icon">${icon('search', 16)}</span>
        <input class="input" id="kwInput" data-i18n-placeholder="common.searchPlaceholder" placeholder="${escapeHtml(t('common.searchPlaceholder'))}" />
      </div>
      <select class="select" id="statusFilter" style="width:130px">
        <option value="">${escapeHtml(t('common.all'))}</option>
        <option value="active">${escapeHtml(t('common.active'))}</option>
        <option value="disabled">${escapeHtml(t('common.disabled'))}</option>
      </select>
      <button class="btn btn-secondary btn-sm" id="refreshBtn">${icon('refresh', 15)} ${escapeHtml(t('common.refresh'))}</button>
      <div class="spacer"></div>
      <button class="btn btn-danger-ghost btn-sm" id="batchDelBtn" disabled>${icon('trash', 15)} ${escapeHtml(t('common.batchDelete'))} (<span id="selCount">0</span>)</button>
      <button class="btn btn-primary btn-sm" id="addBtn">${icon('plus', 15)} ${escapeHtml(t('accounts.add'))}</button>
    </div>

    <div id="tableBox"></div>`;

  // ── 数据加载 ───────────────────────────────────────────────────────────
  async function load() {
    const box = $('#tableBox');
    box.innerHTML = `<div class="empty"><div class="spinner"></div><div class="empty-title">${escapeHtml(t('common.loading'))}</div></div>`;
    try {
      const params = new URLSearchParams({
        page: String(state.page), pageSize: String(state.pageSize),
      });
      if (state.keyword) params.set('keyword', state.keyword);
      if (state.status) params.set('status', state.status);
      const res = await api(`/api/accounts?${params}`);
      renderTable(res);
    } catch (e) {
      box.innerHTML = emptyState({ iconName: 'alert', title: t('common.loadFailed'), desc: e.message });
    }
  }

  function renderTable(res) {
    const list = res.list || [];
    const box = $('#tableBox');
    if (!list.length) {
      box.innerHTML = `
        <div class="card">${emptyState({ iconName: 'cloud', title: t('common.noData'), desc: t('common.noDataDesc') })}</div>`;
      return;
    }
    box.innerHTML = `
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th class="col-check"><input type="checkbox" class="checkbox" id="checkAll" /></th>
              <th>${escapeHtml(t('accounts.name'))}</th>
              <th>${escapeHtml(t('accounts.accountId'))}</th>
              <th>${escapeHtml(t('accounts.resources'))}</th>
              <th>${escapeHtml(t('common.status'))}</th>
              <th>${escapeHtml(t('accounts.lastSync'))}</th>
              <th class="col-actions">${escapeHtml(t('common.actions'))}</th>
            </tr>
          </thead>
          <tbody>
            ${list.map((row) => `
              <tr data-id="${row.id}" class="${state.selected.has(row.id) ? 'selected' : ''}">
                <td class="col-check"><input type="checkbox" class="checkbox row-check" data-id="${row.id}" ${state.selected.has(row.id) ? 'checked' : ''} /></td>
                <td>
                  <div class="flex items-center gap-2">
                    <span class="dot-color c-${escapeHtml(row.color || 'slate')}"></span>
                    <div>
                      <div class="cell-strong">${escapeHtml(row.name)}</div>
                      <div class="text-xs text-muted truncate" style="max-width:200px">${escapeHtml(row.accountName || '—')}</div>
                    </div>
                  </div>
                </td>
                <td>
                  <div class="flex items-center gap-2">
                    <code class="text-xs font-mono">${escapeHtml(row.accountId)}</code>
                    <button class="btn-icon" data-copy="${escapeHtml(row.accountId)}" title="${escapeHtml(t('common.copy'))}">${icon('copy', 13)}</button>
                  </div>
                  <div class="text-xs text-muted">Token: ${escapeHtml(row.apiTokenHint || '••••')}</div>
                </td>
                <td>
                  <div class="flex gap-1 wrap">
                    <span class="badge badge-info">D1 ${formatNumber(row.stats?.d1 || 0)}</span>
                    <span class="badge badge-success">R2 ${formatNumber(row.stats?.r2 || 0)}</span>
                    <span class="badge badge-warning">KV ${formatNumber(row.stats?.kv || 0)}</span>
                  </div>
                </td>
                <td>${statusBadge(row.status)}</td>
                <td>
                  <div class="text-xs">${row.lastSyncAt ? escapeHtml(formatDate(row.lastSyncAt)) : `<span class="text-muted">${escapeHtml(t('accounts.neverSync'))}</span>`}</div>
                  <div class="text-xs text-muted">${row.lastSyncAt ? escapeHtml(timeAgo(row.lastSyncAt)) : ''}</div>
                </td>
                <td>
                  <div class="cell-actions">
                    <button class="btn btn-sm btn-secondary" data-action="test" data-id="${row.id}" title="${escapeHtml(t('accounts.test'))}">${icon('zap', 14)}</button>
                    <button class="btn btn-sm btn-secondary" data-action="sync" data-id="${row.id}" title="${escapeHtml(t('accounts.sync'))}">${icon('refresh', 14)}</button>
                    <button class="btn btn-sm btn-ghost" data-action="edit" data-id="${row.id}" title="${escapeHtml(t('common.edit'))}">${icon('edit', 14)}</button>
                    <button class="btn btn-sm btn-danger-ghost" data-action="delete" data-id="${row.id}" title="${escapeHtml(t('common.delete'))}">${icon('trash', 14)}</button>
                  </div>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      ${pagination(res.pagination)}`;

    // 全选
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

    container.querySelectorAll('[data-copy]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await copyText(btn.dataset.copy);
        toastSuccess(t('common.copied'));
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

  // ── 行操作 ─────────────────────────────────────────────────────────────
  async function handleAction(action, id) {
    if (action === 'edit') return openForm(id);
    if (action === 'delete') {
      const ok = await confirmDialog({ title: t('common.confirmDeleteTitle'), desc: `${t('common.confirmDeleteDesc')}<br/><span class="text-danger text-sm">${escapeHtml(t('accounts.deleteWarn'))}</span>` });
      if (!ok) return;
      try {
        await del(`/api/accounts/${id}`);
        toastSuccess(t('accounts.deleteSuccess'));
        load();
      } catch (e) { toastError(e.message); }
      return;
    }
    if (action === 'test') {
      try {
        const res = await post(`/api/accounts/${id}/test`);
        if (res.tokenValid) toastSuccess(t('accounts.testOk'));
        else toastError(`${t('accounts.testFail')}: ${(res.errors || []).join('; ') || ''}`);
      } catch (e) { toastError(e.message); }
      return;
    }
    if (action === 'sync') {
      const btn = container.querySelector(`[data-action="sync"][data-id="${id}"]`);
      if (btn) btn.classList.add('btn-loading');
      try {
        const res = await post(`/api/accounts/${id}/sync`);
        const errs = (res.errors || []).length ? ` ⚠ ${(res.errors || []).join(' | ')}` : '';
        toastSuccess(`${t('accounts.syncDone')}: D1 ${res.d1} / R2 ${res.r2} / KV ${res.kv}${errs}`);
        load();
      } catch (e) {
        toastError(e.message);
        if (btn) btn.classList.remove('btn-loading');
      }
    }
  }

  // ── 新增 / 编辑表单 ────────────────────────────────────────────────────
  async function openForm(id) {
    let row = null;
    if (id) {
      try {
        const res = await api(`/api/accounts/${id}`);
        row = res.account;
      } catch (e) {
        toastError(e.message);
        return;
      }
    }
    const isEdit = Boolean(row);

    const modal = openModal({
      title: isEdit ? t('accounts.edit') : t('accounts.add'),
      size: 'wide',
      body: `
        <form id="accForm" autocomplete="off">
          <div class="grid-2">
            <div class="field">
              <label class="field-label">${escapeHtml(t('accounts.name'))}<span class="req">*</span></label>
              <input class="input" name="name" required maxlength="64" value="${escapeHtml(row?.name || '')}" placeholder="${escapeHtml(t('accounts.namePlaceholder'))}" />
            </div>
            <div class="field">
              <label class="field-label">${escapeHtml(t('accounts.accountId'))}<span class="req">*</span></label>
              <input class="input" name="accountId" required maxlength="64" value="${escapeHtml(row?.accountId || '')}" placeholder="0123456789abcdef0123456789abcdef" />
              <div class="field-hint">${escapeHtml(t('accounts.accountIdHint'))}</div>
            </div>
          </div>

          <div class="field">
            <label class="field-label">${escapeHtml(t('accounts.apiToken'))}${isEdit ? '' : '<span class="req">*</span>'}</label>
            <input class="input" name="apiToken" maxlength="400" ${isEdit ? '' : 'required'}
                   placeholder="${escapeHtml(isEdit ? t('accounts.tokenPlaceholder') : 'Bearer token…')}" />
            <div class="field-hint">${escapeHtml(t('accounts.apiTokenHint'))}</div>
          </div>

          <div class="divider"></div>

          <div class="grid-2">
            <div class="field">
              <label class="field-label">${escapeHtml(t('accounts.r2Key'))}</label>
              <input class="input" name="r2AccessKeyId" maxlength="128" value="${escapeHtml(row?.r2AccessKeyId || '')}" placeholder="Access Key ID" />
              <div class="field-hint">${escapeHtml(t('accounts.r2KeyHint'))}</div>
            </div>
            <div class="field">
              <label class="field-label">${escapeHtml(t('accounts.r2Secret'))}</label>
              <input class="input" name="r2SecretAccessKey" maxlength="200" placeholder="${escapeHtml(isEdit ? t('accounts.tokenPlaceholder') : 'Secret Access Key')}" />
            </div>
          </div>

          <div class="grid-2">
            <div class="field">
              <label class="field-label">${escapeHtml(t('accounts.r2Endpoint'))}</label>
              <input class="input" name="r2Endpoint" maxlength="200" value="${escapeHtml(row?.r2Endpoint || '')}" placeholder="https://{account_id}.r2.cloudflarestorage.com" />
            </div>
            <div class="field">
              <label class="field-label">${escapeHtml(t('accounts.color'))}</label>
              <div class="accent-grid">
                ${COLORS.map((c) => `
                  <span class="accent-dot ${c === (row?.color || 'indigo') ? 'active' : ''}" data-color="${c}"
                        style="background:${colorHex(c)}" title="${c}"></span>`).join('')}
              </div>
              <input type="hidden" name="color" value="${escapeHtml(row?.color || 'indigo')}" />
            </div>
          </div>

          <div class="grid-2">
            <div class="field">
              <label class="field-label">${escapeHtml(t('common.status'))}</label>
              <select class="select" name="status">
                <option value="active" ${row?.status !== 'disabled' ? 'selected' : ''}>${escapeHtml(t('common.active'))}</option>
                <option value="disabled" ${row?.status === 'disabled' ? 'selected' : ''}>${escapeHtml(t('common.disabled'))}</option>
              </select>
            </div>
            <div class="field">
              <label class="field-label">${escapeHtml(t('common.note'))} (${escapeHtml(t('common.optional'))})</label>
              <input class="input" name="note" maxlength="500" value="${escapeHtml(row?.note || '')}" />
            </div>
          </div>
        </form>`,
      footer: `
        <button class="btn btn-secondary" data-close>${escapeHtml(t('common.cancel'))}</button>
        <button class="btn btn-primary" id="saveBtn">${escapeHtml(t('common.save'))}</button>`,
      onOpen(m) {
        m.el.querySelectorAll('[data-color]').forEach((dot) => {
          dot.addEventListener('click', () => {
            m.el.querySelectorAll('[data-color]').forEach((d) => d.classList.remove('active'));
            dot.classList.add('active');
            m.el.querySelector('[name="color"]').value = dot.dataset.color;
          });
        });

        m.el.querySelector('#saveBtn').addEventListener('click', async () => {
          const form = m.el.querySelector('#accForm');
          const fd = new FormData(form);
          const body = Object.fromEntries(fd.entries());
          const btn = m.el.querySelector('#saveBtn');
          btn.classList.add('btn-loading');
          btn.disabled = true;
          try {
            if (isEdit) await put(`/api/accounts/${id}`, body);
            else await post('/api/accounts', body);
            toastSuccess(isEdit ? t('accounts.updateSuccess') : t('accounts.addSuccess'));
            m.close();
            load();
          } catch (e) {
            toastError(e.message);
          } finally {
            btn.classList.remove('btn-loading');
            btn.disabled = false;
          }
        });
      },
    });
    return modal;
  }

  function colorHex(c) {
    const map = {
      indigo: '#6366f1', blue: '#3b82f6', cyan: '#06b6d4', teal: '#14b8a6',
      green: '#22c55e', amber: '#f59e0b', orange: '#f97316', rose: '#f43f5e',
      violet: '#8b5cf6', slate: '#64748b',
    };
    return map[c] || map.slate;
  }

  // ── 事件绑定 ───────────────────────────────────────────────────────────
  $('#kwInput').addEventListener('input', debounce((e) => {
    state.keyword = e.target.value.trim();
    state.page = 1;
    load();
  }, 320));
  $('#statusFilter').addEventListener('change', (e) => {
    state.status = e.target.value;
    state.page = 1;
    load();
  });
  $('#refreshBtn').addEventListener('click', load);
  $('#addBtn').addEventListener('click', () => openForm(null));
  $('#batchDelBtn').addEventListener('click', async () => {
    const ids = [...state.selected];
    if (!ids.length) return;
    const ok = await confirmDialog({
      title: t('common.batchDeleteTitle'),
      desc: t('common.batchDeleteDesc', { n: ids.length }),
    });
    if (!ok) return;
    try {
      await post('/api/accounts/batch-delete', { ids });
      toastSuccess(t('common.deleteSuccess'));
      state.selected.clear();
      updateSelCount();
      load();
    } catch (e) { toastError(e.message); }
  });

  await load();
}
