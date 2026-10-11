/**
 * 资源管理页（D1 / R2 / KV 通用）
 */
import { t } from '../i18n.js';
import { api, post, put, del, download, readFileAsJson } from '../api.js';
import {
  icon, escapeHtml, formatNumber, formatBytes, formatDate, timeAgo, pagination,
  emptyState, toastSuccess, toastError, openModal, confirmDialog, debounce,
  statusBadge, copyText,
} from '../ui.js';

const CONFIG = {
  d1: {
    apiBase: '/api/d1',
    nameKey: 'res.name',
    nameLabel: '数据库名称',
    idLabel: 'Database ID',
    idPlaceholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
    stats: (row) => [
      { label: t('res.tables'), value: formatNumber(row.numTables) },
      { label: t('res.rows'), value: formatNumber(row.rowsCount) },
      { label: t('res.fileSize'), value: formatBytes(row.fileSize) },
    ],
    extraAction: { action: 'tables', icon: 'layers', label: 'res.viewTables' },
    canExport: true,
    canRestore: true,
    exportPath: (row) => `/api/d1/${row.id}/export?format=sql`,
  },
  r2: {
    apiBase: '/api/r2',
    nameKey: 'res.name',
    nameLabel: '存储桶名称',
    idLabel: 'Bucket Name',
    idPlaceholder: 'my-bucket',
    stats: (row) => [
      { label: t('res.objects'), value: formatNumber(row.objectCount) },
      { label: t('common.size'), value: formatBytes(row.totalSize) },
    ],
    extraAction: { action: 'objects', icon: 'folder', label: 'res.viewObjects' },
    canExport: true,
    canRestore: false,
    exportPath: (row) => `/api/r2/${row.id}/manifest`,
  },
  kv: {
    apiBase: '/api/kv',
    nameKey: 'res.name',
    nameLabel: '命名空间标题',
    idLabel: 'Namespace ID',
    idPlaceholder: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    stats: (row) => [
      { label: t('res.keys'), value: formatNumber(row.keyCount) },
      { label: t('common.size'), value: formatBytes(row.totalSize) },
    ],
    extraAction: { action: 'keys', icon: 'key', label: 'res.viewKeys' },
    canExport: true,
    canRestore: true,
    exportPath: (row) => `/api/kv/${row.id}/export`,
  },
};

export function createResourcePage(type) {
  const cfg = CONFIG[type];

  return async function renderResourcePage({ container, refresh, navigate }) {
    const $ = (sel) => container.querySelector(sel);
    const state = { keyword: '', accountId: '', page: 1, pageSize: 15, selected: new Set(), accounts: [] };

    container.innerHTML = `
      <div class="toolbar">
        <div class="input-group search">
          <span class="input-icon">${icon('search', 16)}</span>
          <input class="input" id="kwInput" data-i18n-placeholder="res.searchPlaceholder"
                 placeholder="${escapeHtml(t('res.searchPlaceholder'))}" />
        </div>
        <select class="select" id="accFilter" style="width:180px">
          <option value="">${escapeHtml(t('res.allAccounts'))}</option>
        </select>
        <button class="btn btn-secondary btn-sm" id="refreshBtn">${icon('refresh', 15)} ${escapeHtml(t('common.refresh'))}</button>
        <div class="spacer"></div>
        ${cfg.canRestore ? `<button class="btn btn-secondary btn-sm" id="restoreBtn">${icon('upload', 15)} ${escapeHtml(t('res.restore'))}</button>` : ''}
        <button class="btn btn-danger-ghost btn-sm" id="batchDelBtn" disabled>${icon('trash', 15)} ${escapeHtml(t('common.batchDelete'))} (<span id="selCount">0</span>)</button>
        <button class="btn btn-primary btn-sm" id="addBtn">${icon('plus', 15)} ${escapeHtml(t('res.add', { name: cfg.nameLabel }))}</button>
      </div>

      <div id="tableBox"></div>`;

    // ── 账号下拉 ───────────────────────────────────────────────────────
    async function loadAccounts() {
      try {
        const res = await api('/api/accounts/options');
        state.accounts = res.list || [];
        const sel = $('#accFilter');
        state.accounts.forEach((a) => {
          const opt = document.createElement('option');
          opt.value = String(a.id);
          opt.textContent = `${a.name} (${a.account_id.slice(0, 8)}…)`;
          sel.appendChild(opt);
        });
      } catch { /* 忽略 */ }
    }

    // ── 数据加载 ───────────────────────────────────────────────────────
    async function load() {
      const box = $('#tableBox');
      box.innerHTML = `<div class="empty"><div class="spinner"></div><div class="empty-title">${escapeHtml(t('common.loading'))}</div></div>`;
      try {
        const params = new URLSearchParams({ page: String(state.page), pageSize: String(state.pageSize) });
        if (state.keyword) params.set('keyword', state.keyword);
        if (state.accountId) params.set('accountId', state.accountId);
        const res = await api(`${cfg.apiBase}?${params}`);
        renderTable(res);
      } catch (e) {
        box.innerHTML = emptyState({ iconName: 'alert', title: t('common.loadFailed'), desc: e.message });
      }
    }

    function renderTable(res) {
      const list = res.list || [];
      state.rows = Object.fromEntries(list.map((r) => [r.id, r]));
      const box = $('#tableBox');
      if (!list.length) {
        box.innerHTML = `<div class="card">${emptyState({ iconName: 'inbox', title: t('common.noData'), desc: t('common.noDataDesc') })}</div>`;
        return;
      }

      box.innerHTML = `
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th class="col-check"><input type="checkbox" class="checkbox" id="checkAll" /></th>
                <th>${escapeHtml(t(cfg.nameKey))}</th>
                <th>${escapeHtml(t('res.resourceId'))}</th>
                <th>${escapeHtml(t('res.account'))}</th>
                <th>${escapeHtml(t('common.status'))}</th>
                <th>${escapeHtml(t('common.lastSync'))}</th>
                <th class="col-actions">${escapeHtml(t('common.actions'))}</th>
              </tr>
            </thead>
            <tbody>
              ${list.map((row) => `
                <tr data-id="${row.id}" class="${state.selected.has(row.id) ? 'selected' : ''}">
                  <td class="col-check"><input type="checkbox" class="checkbox row-check" data-id="${row.id}" ${state.selected.has(row.id) ? 'checked' : ''} /></td>
                  <td>
                    <div class="cell-strong truncate" style="max-width:220px" title="${escapeHtml(row.name)}">${escapeHtml(row.name)}</div>
                    <div class="flex gap-1 wrap mt-1">
                      ${cfg.stats(row).map((s) => `<span class="chip" style="height:21px;font-size:11px">${escapeHtml(s.label)} <b>${escapeHtml(String(s.value))}</b></span>`).join('')}
                    </div>
                  </td>
                  <td>
                    <div class="flex items-center gap-2">
                      <code class="text-xs font-mono truncate" style="max-width:190px">${escapeHtml(row.resourceId)}</code>
                      <button class="btn-icon" data-copy="${escapeHtml(row.resourceId)}" title="${escapeHtml(t('common.copy'))}">${icon('copy', 13)}</button>
                    </div>
                  </td>
                  <td>
                    <div class="flex items-center gap-2">
                      <span class="dot-color c-${escapeHtml(row.accountColor || 'slate')}"></span>
                      <div>
                        <div class="text-sm">${escapeHtml(row.accountName || '—')}</div>
                        <div class="text-xs text-muted font-mono">${escapeHtml((row.cfAccountId || '').slice(0, 10))}${row.cfAccountId ? '…' : ''}</div>
                      </div>
                    </div>
                  </td>
                  <td>${statusBadge(row.status)}</td>
                  <td class="text-xs text-muted">${row.lastSyncAt ? escapeHtml(timeAgo(row.lastSyncAt)) : '—'}</td>
                  <td>
                    <div class="cell-actions">
                      ${cfg.extraAction ? `<button class="btn btn-sm btn-ghost" data-action="${cfg.extraAction.action}" data-id="${row.id}" title="${escapeHtml(t(cfg.extraAction.label))}">${icon(cfg.extraAction.icon, 14)}</button>` : ''}
                      ${cfg.canExport ? `<button class="btn btn-sm btn-secondary" data-action="export" data-id="${row.id}" title="${escapeHtml(t('res.backup'))}">${icon('download', 14)}</button>` : ''}
                      <button class="btn btn-sm btn-secondary" data-action="migrate" data-id="${row.id}" title="${escapeHtml(t('res.migrate'))}">${icon('arrowRight', 14)}</button>
                      <button class="btn btn-sm btn-ghost" data-action="edit" data-id="${row.id}" title="${escapeHtml(t('common.edit'))}">${icon('edit', 14)}</button>
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

    function findRow(id) {
      return container.querySelector(`tr[data-id="${id}"]`);
    }

    // ── 行操作 ─────────────────────────────────────────────────────────
    async function handleAction(action, id) {
      if (action === 'edit') return openForm(id);
      if (action === 'delete') {
        const ok = await confirmDialog({
          title: t('common.confirmDeleteTitle'),
          desc: `${t('common.confirmDeleteDesc')}<br/><span class="text-danger text-sm">${escapeHtml(t('res.deleteWarn'))}</span>`,
        });
        if (!ok) return;
        try {
          await del(`${cfg.apiBase}/${id}`);
          toastSuccess(t('common.deleteSuccess'));
          load();
        } catch (e) { toastError(e.message); }
        return;
      }
      if (action === 'export') {
        try {
          const name = await download(cfg.exportPath({ id }));
          toastSuccess(`${t('res.exportDone')}: ${name}`);
        } catch (e) { toastError(e.message); }
        return;
      }
      if (action === 'migrate') return openMigrate(id);
      if (action === 'tables' || action === 'keys' || action === 'objects') return openExplorer(id, action);
    }

    // ── 新增 / 编辑 ────────────────────────────────────────────────────
    async function openForm(id) {
      let row = null;
      if (id) row = state.rows?.[id] || null;
      const isEdit = Boolean(row);

      openModal({
        title: isEdit ? t('res.editTitle', { name: cfg.nameLabel }) : t('res.add', { name: cfg.nameLabel }),
        body: `
          <form id="resForm">
            ${!isEdit ? `
              <div class="field">
                <label class="field-label">${escapeHtml(t('res.account'))}<span class="req">*</span></label>
                <select class="select" name="accountId" required>
                  <option value="">${escapeHtml(t('common.all'))}</option>
                  ${state.accounts.map((a) => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('')}
                </select>
              </div>` : ''}
            <div class="field">
              <label class="field-label">${escapeHtml(cfg.nameLabel)}<span class="req">*</span></label>
              <input class="input" name="name" required maxlength="128" value="${escapeHtml(row?.name || '')}" />
            </div>
            <div class="field">
              <label class="field-label">${escapeHtml(cfg.idLabel)}</label>
              <input class="input" name="resourceId" maxlength="128"
                     value="${escapeHtml(row?.resourceId || '')}" placeholder="${escapeHtml(cfg.idPlaceholder)}"
                     ${isEdit ? 'readonly disabled' : ''} />
              <div class="field-hint">${escapeHtml(isEdit ? '' : '留空则与名称相同')}</div>
            </div>
            <div class="field">
              <label class="field-label">${escapeHtml(t('common.note'))} (${escapeHtml(t('common.optional'))})</label>
              <textarea class="textarea" name="note" maxlength="500">${escapeHtml(row?.note || '')}</textarea>
            </div>
            <div class="field">
              <label class="field-label">${escapeHtml(t('common.status'))}</label>
              <select class="select" name="status">
                <option value="active" ${row?.status !== 'disabled' ? 'selected' : ''}>${escapeHtml(t('common.active'))}</option>
                <option value="disabled" ${row?.status === 'disabled' ? 'selected' : ''}>${escapeHtml(t('common.disabled'))}</option>
              </select>
            </div>
          </form>`,
        footer: `
          <button class="btn btn-secondary" data-close>${escapeHtml(t('common.cancel'))}</button>
          <button class="btn btn-primary" id="saveBtn">${escapeHtml(t('common.save'))}</button>`,
        onOpen(m) {
          m.el.querySelector('#saveBtn').addEventListener('click', async () => {
            const form = m.el.querySelector('#resForm');
            const body = Object.fromEntries(new FormData(form).entries());
            const btn = m.el.querySelector('#saveBtn');
            btn.classList.add('btn-loading');
            try {
              if (isEdit) await put(`${cfg.apiBase}/${id}`, body);
              else await post(cfg.apiBase, body);
              toastSuccess(t('common.saveSuccess'));
              m.close();
              load();
            } catch (e) {
              toastError(e.message);
            } finally {
              btn.classList.remove('btn-loading');
            }
          });
        },
      });
    }

    // ── 迁移 ───────────────────────────────────────────────────────────
    async function openMigrate(id) {
      if (!state.accounts.length) {
        toastError(t('res.selectAccountFirst'));
        return;
      }
      openModal({
        title: t('res.migrateTitle'),
        subtitle: t('res.migrateDesc'),
        body: `
          <form id="migForm">
            <div class="field">
              <label class="field-label">${escapeHtml(t('res.targetAccount'))}<span class="req">*</span></label>
              <select class="select" name="targetAccountId" required>
                ${state.accounts.map((a) => `<option value="${a.id}">${escapeHtml(a.name)} (${escapeHtml(a.account_id.slice(0, 8))}…)</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label class="field-label">${escapeHtml(t('res.targetResource'))}</label>
              <input class="input" name="${type === 'kv' ? 'targetNamespaceId' : type === 'r2' ? 'targetBucketName' : 'targetDatabaseId'}"
                     maxlength="128" placeholder="${escapeHtml(cfg.idPlaceholder)}" />
              <div class="field-hint">${escapeHtml(t('res.targetResourceHint'))}</div>
            </div>
            ${type === 'd1' ? `
              <div class="field">
                <label class="field-label">${escapeHtml(t('res.targetResource'))} (${escapeHtml(t('common.name'))})</label>
                <input class="input" name="targetDatabaseName" maxlength="128" placeholder="db-migrated" />
              </div>` : ''}
            ${type === 'kv' ? `
              <div class="field">
                <label class="field-label">${escapeHtml(t('res.targetResource'))} (${escapeHtml(t('common.name'))})</label>
                <input class="input" name="targetTitle" maxlength="128" placeholder="kv-migrated" />
              </div>` : ''}
            ${type === 'r2' ? `
              <div class="field">
                <label class="flex items-center gap-2" style="cursor:pointer">
                  <input type="checkbox" class="checkbox" name="createTargetBucket" checked />
                  <span class="text-sm">${escapeHtml(t('res.createTarget'))}</span>
                </label>
              </div>` : ''}
            <div class="notice notice-info">
              ${icon('info', 16)}
              <div>${escapeHtml(t('common.processing'))}</div>
            </div>
            <div id="migProgressWrap" class="mt-3" style="display:none">
              <div class="progress"><div class="bar" id="migBar" style="width:0%"></div></div>
              <div id="migProgress" class="text-xs text-muted mt-2"></div>
            </div>
          </form>`,
        footer: `
          <button class="btn btn-secondary" data-close>${escapeHtml(t('common.cancel'))}</button>
          <button class="btn btn-primary" id="migBtn">${icon('arrowRight', 15)} ${escapeHtml(t('res.startMigrate'))}</button>`,
        onOpen(m) {
          m.el.querySelector('#migBtn').addEventListener('click', async () => {
            const form = m.el.querySelector('#migForm');
            const fd = new FormData(form);
            const body = Object.fromEntries(fd.entries());
            body.createTargetBucket = fd.has('createTargetBucket');
            const btn = m.el.querySelector('#migBtn');
            btn.classList.add('btn-loading');
            btn.disabled = true;
            try {
              const progWrap = m.el.querySelector('#migProgressWrap');
              const progBar = m.el.querySelector('#migBar');
              const progText = m.el.querySelector('#migProgress');
              const fmt = (n) => Number(n || 0).toLocaleString();
              const showProgress = (r, done = false) => {
                if (!progWrap || !r || typeof r.rowsDone !== 'number') return;
                const pct = r.rowsTotal ? Math.min(100, Math.round((r.rowsDone / r.rowsTotal) * 100)) : 0;
                progWrap.style.display = '';
                if (progBar) progBar.style.width = `${done ? 100 : pct}%`;
                if (done) progWrap.querySelector('.progress')?.classList.add('success');
                if (progText) {
                  progText.textContent = r.rowsTotal
                    ? `${done ? '迁移完成' : '迁移中'}：${fmt(r.rowsDone)} / ${fmt(r.rowsTotal)} 行 · ${done ? 100 : pct}%`
                    : `${done ? '迁移完成' : '迁移中'}：${fmt(r.rowsDone)} 行`;
                }
              };
              let res = await post(`${cfg.apiBase}/${id}/migrate`, body);
              showProgress(res, res.done);
              if (type === 'd1') {
                // 分批续传：循环调用步进接口直至完成（中断后重跑可断点续传）
                let guard = 0;
                while (!res.done && guard < 10000) {
                  res = await post('/api/d1/migrate-step', { taskId: res.taskId });
                  showProgress(res, res.done);
                  guard += 1;
                }
              }
              toastSuccess(`${t('res.migrateDone')}: ${res.result?.rows ?? res.result?.keys ?? res.result?.copied ?? ''}`);
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
    }

    // ── 恢复（D1 / KV）─────────────────────────────────────────────────
    if (cfg.canRestore) {
      $('#restoreBtn').addEventListener('click', () => {
        openModal({
          title: t('res.restoreTitle'),
          subtitle: t('res.restoreDesc'),
          body: `
            <form id="resForm">
              <div class="field">
                <label class="field-label">${escapeHtml(t('res.account'))}<span class="req">*</span></label>
                <select class="select" name="targetAccountId" required>
                  ${state.accounts.map((a) => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('')}
                </select>
              </div>
              <div class="field">
                <label class="field-label">${escapeHtml(type === 'kv' ? 'Namespace ID' : 'Database ID')}<span class="req">*</span></label>
                <input class="input" name="${type === 'kv' ? 'targetNamespaceId' : 'targetDatabaseId'}" required maxlength="128" />
              </div>
              <div class="field">
                <label class="field-label">${escapeHtml(t('res.backupFile'))}<span class="req">*</span></label>
                <input class="input" type="file" name="file" accept=".json,.kv.json" required style="padding:7px 10px;height:auto" />
              </div>
              ${type === 'd1' ? `
                <div class="field">
                  <label class="flex items-center gap-2" style="cursor:pointer">
                    <input type="checkbox" class="checkbox" name="dropExisting" />
                    <span class="text-sm">${escapeHtml(t('res.dropExisting'))}</span>
                  </label>
                </div>` : ''}
            </form>`,
          footer: `
            <button class="btn btn-secondary" data-close>${escapeHtml(t('common.cancel'))}</button>
            <button class="btn btn-primary" id="restoreRunBtn">${icon('upload', 15)} ${escapeHtml(t('res.startRestore'))}</button>`,
          onOpen(m) {
            m.el.querySelector('#restoreRunBtn').addEventListener('click', async () => {
              const form = m.el.querySelector('#resForm');
              const fd = new FormData(form);
              const file = fd.get('file');
              if (!file || !file.size) { toastError(t('res.backupFile')); return; }
              const btn = m.el.querySelector('#restoreRunBtn');
              btn.classList.add('btn-loading');
              try {
                const dump = await readFileAsJson(file);
                const body = {
                  targetAccountId: Number(fd.get('targetAccountId')),
                  dropExisting: fd.has('dropExisting'),
                  dump,
                };
                body[type === 'kv' ? 'targetNamespaceId' : 'targetDatabaseId'] =
                  fd.get(type === 'kv' ? 'targetNamespaceId' : 'targetDatabaseId');
                await post(`/api/${type}/restore`, body);
                toastSuccess(t('res.restoreDone'));
                m.close();
              } catch (e) {
                toastError(e.message);
              } finally {
                btn.classList.remove('btn-loading');
              }
            });
          },
        });
      });
    }

    // ── 数据浏览（表 / 键 / 对象）──────────────────────────────────────
    async function openExplorer(id, action) {
      const modal = openModal({
        title: t(cfg.extraAction.label),
        size: 'wide',
        body: `<div class="empty"><div class="spinner"></div><div class="empty-title">${escapeHtml(t('common.loading'))}</div></div>`,
      });
      try {
        if (action === 'tables') {
          const res = await api(`/api/d1/${id}/tables`);
          modal.body.innerHTML = `
            <div class="table-wrap" style="border:0">
              <table class="table" style="min-width:0">
                <thead><tr><th>${escapeHtml(t('common.name'))}</th><th>${escapeHtml(t('common.type'))}</th></tr></thead>
                <tbody>
                  ${(res.list || []).map((x) => `<tr><td class="cell-strong">${escapeHtml(x.name)}</td><td>${escapeHtml(x.type)}</td></tr>`).join('')}
                </tbody>
              </table>
            </div>`;
        } else if (action === 'keys') {
          const res = await api(`/api/kv/${id}/keys?limit=200`);
          modal.body.innerHTML = `
            <div class="table-wrap" style="border:0">
              <table class="table" style="min-width:0">
                <thead><tr><th>Key</th><th>${escapeHtml(t('common.time'))}</th></tr></thead>
                <tbody>
                  ${(res.list || []).map((x) => `
                    <tr>
                      <td class="cell-strong font-mono text-xs">${escapeHtml(x.name)}</td>
                      <td class="text-xs text-muted">${x.expiration ? escapeHtml(formatDate(x.expiration * 1000)) : '—'}</td>
                    </tr>`).join('')}
                </tbody>
              </table>
            </div>`;
        } else {
          const res = await api(`/api/r2/${id}/objects?limit=200`);
          modal.body.innerHTML = `
            <div class="table-wrap" style="border:0">
              <table class="table" style="min-width:0">
                <thead><tr><th>Key</th><th>${escapeHtml(t('common.size'))}</th><th>${escapeHtml(t('common.time'))}</th></tr></thead>
                <tbody>
                  ${(res.contents || []).map((x) => `
                    <tr>
                      <td class="cell-strong font-mono text-xs truncate" style="max-width:320px">${escapeHtml(x.key)}</td>
                      <td>${escapeHtml(formatBytes(x.size))}</td>
                      <td class="text-xs text-muted">${escapeHtml(formatDate(x.lastModified))}</td>
                    </tr>`).join('')}
                </tbody>
              </table>
            </div>`;
        }
      } catch (e) {
        modal.body.innerHTML = emptyState({ iconName: 'alert', title: t('common.loadFailed'), desc: e.message });
      }
    }

    // ── 事件绑定 ───────────────────────────────────────────────────────
    $('#kwInput').addEventListener('input', debounce((e) => {
      state.keyword = e.target.value.trim();
      state.page = 1;
      load();
    }, 320));
    $('#accFilter').addEventListener('change', (e) => {
      state.accountId = e.target.value;
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
        await post(`${cfg.apiBase}/batch-delete`, { ids });
        toastSuccess(t('common.deleteSuccess'));
        state.selected.clear();
        updateSelCount();
        load();
      } catch (e) { toastError(e.message); }
    });

    await loadAccounts();
    await load();
  };
}
