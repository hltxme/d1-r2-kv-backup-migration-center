/**
 * UI 组件库：图标、Toast、Modal、表格、分页、格式化
 */
import { t } from './i18n.js';

// ===========================================================================
// 图标（内联 SVG，无外部依赖）
// ===========================================================================

const PATHS = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  cloud: '<path d="M17.5 19a4.5 4.5 0 0 0 .5-8.97A6 6 0 0 0 6.2 9.3 4 4 0 0 0 6.5 19h11z"/>',
  database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.66 3.58 3 8 3s8-1.34 8-3V5"/><path d="M4 11v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6"/>',
  bucket: '<path d="M3 6h18l-1.6 13.2A2 2 0 0 1 17.4 21H6.6a2 2 0 0 1-2-1.8L3 6z"/><path d="M3 6l2-3h14l2 3"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M10.85 12.15 19 4"/><path d="M17 6l2 2"/><path d="M14.5 8.5l2 2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>',
  moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/>',
  edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  alert: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
  chevronDown: '<path d="M6 9l6 6 6-6"/>',
  chevronLeft: '<path d="M15 18l-6-6 6-6"/>',
  chevronRight: '<path d="M9 18l6-6-6-6"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  layers: '<path d="M12 2 2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14 21 3"/>',
  play: '<path d="M5 3l14 9-14 9V3z"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
  eye: '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><path d="M1 1l22 22"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
  server: '<rect x="2" y="3" width="20" height="8" rx="2"/><rect x="2" y="13" width="20" height="8" rx="2"/><path d="M6 7h.01M6 17h.01"/>',
  arrowRight: '<path d="M5 12h14M12 5l7 7-7 7"/>',
  filter: '<path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
};

export function icon(name, size = 18, extraClass = '') {
  const d = PATHS[name] || PATHS.info;
  return `<svg class="icon ${extraClass}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
}

// ===========================================================================
// 工具
// ===========================================================================

export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function debounce(fn, wait = 300) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

export function formatNumber(n) {
  const v = Number(n || 0);
  if (!Number.isFinite(v)) return '0';
  return v.toLocaleString();
}

export function formatBytes(bytes, digits = 1) {
  const b = Number(bytes || 0);
  if (!Number.isFinite(b) || b <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(b) / Math.log(1024)), units.length - 1);
  return `${(b / 1024 ** i).toFixed(i === 0 ? 0 : digits)} ${units[i]}`;
}

export function formatDate(value, { withSeconds = true } = {}) {
  if (!value) return '—';
  let d = value;
  if (typeof d === 'string' && !d.includes('T') && d.includes(' ')) d = d.replace(' ', 'T');
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return String(value);
  const pad = (n) => String(n).padStart(2, '0');
  const base = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return withSeconds ? `${base}:${pad(date.getSeconds())}` : base;
}

export function timeAgo(value) {
  if (!value) return '—';
  let d = value;
  if (typeof d === 'string' && !d.includes('T') && d.includes(' ')) d = d.replace(' ', 'T');
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return String(value);
  // SQLite datetime('now') 是 UTC
  const ts = typeof value === 'string' && !value.includes('T')
    ? date.getTime() + new Date().getTimezoneOffset() * 60000
    : date.getTime();
  const diff = Date.now() - ts;
  const abs = Math.abs(diff);
  const suffix = diff >= 0 ? '' : '';
  const min = 60000; const hour = 3600000; const day = 86400000;
  if (abs < min) return `${suffix}${Math.max(1, Math.round(abs / 1000))}s`;
  if (abs < hour) return `${suffix}${Math.round(abs / min)}m`;
  if (abs < day) return `${suffix}${Math.round(abs / hour)}h`;
  return `${suffix}${Math.round(abs / day)}d`;
}

export function formatDuration(ms) {
  const v = Number(ms || 0);
  if (v < 1000) return `${v}ms`;
  if (v < 60000) return `${(v / 1000).toFixed(1)}s`;
  const m = Math.floor(v / 60000);
  const s = Math.round((v % 60000) / 1000);
  return `${m}m ${s}s`;
}

// ===========================================================================
// Toast
// ===========================================================================

let toastWrap = null;

function ensureToastWrap() {
  if (!toastWrap || !document.body.contains(toastWrap)) {
    toastWrap = document.createElement('div');
    toastWrap.className = 'toast-wrap';
    document.body.appendChild(toastWrap);
  }
  return toastWrap;
}

export function toast(message, { type = 'success', title = '', duration = 3200, desc = '' } = {}) {
  const wrap = ensureToastWrap();
  const iconName = { success: 'check', error: 'alert', warning: 'alert', info: 'info' }[type] || 'info';
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `
    <div class="t-icon">${icon(iconName, 19)}</div>
    <div style="min-width:0">
      <div class="t-title">${escapeHtml(title || message)}</div>
      ${desc || (title && message !== title) ? `<div class="t-desc">${escapeHtml(desc || message)}</div>` : ''}
    </div>`;
  wrap.appendChild(el);
  const remove = () => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 240);
  };
  setTimeout(remove, duration);
  el.addEventListener('click', remove);
  return el;
}

export const toastSuccess = (msg, opts = {}) => toast(msg, { type: 'success', ...opts });
export const toastError = (msg, opts = {}) => toast(msg, { type: 'error', ...opts });
export const toastInfo = (msg, opts = {}) => toast(msg, { type: 'info', ...opts });

// ===========================================================================
// Modal
// ===========================================================================

export function openModal({
  title = '',
  subtitle = '',
  body = '',
  footer = '',
  size = '',            // '' | 'wide' | 'narrow'
  closable = true,
  onOpen = null,
  onClose = null,
} = {}) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal ${size}">
      <div class="modal-header">
        <div>
          <div class="modal-title">${escapeHtml(title)}</div>
          ${subtitle ? `<div class="modal-subtitle">${escapeHtml(subtitle)}</div>` : ''}
        </div>
        ${closable ? `<button class="btn-icon modal-close" data-close>${icon('x', 18)}</button>` : ''}
      </div>
      <div class="modal-body">${body}</div>
      ${footer ? `<div class="modal-footer">${footer}</div>` : ''}
    </div>`;

  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', escHandler);
    if (onClose) onClose();
  };
  const escHandler = (e) => { if (e.key === 'Escape' && closable) close(); };

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop && closable) close();
  });
  backdrop.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', close));
  document.addEventListener('keydown', escHandler);
  document.body.appendChild(backdrop);

  const apiObj = {
    el: backdrop,
    body: backdrop.querySelector('.modal-body'),
    close,
    setFooter(html) {
      let footerEl = backdrop.querySelector('.modal-footer');
      if (!footerEl) {
        footerEl = document.createElement('div');
        footerEl.className = 'modal-footer';
        backdrop.querySelector('.modal').appendChild(footerEl);
      }
      footerEl.innerHTML = html;
    },
  };
  if (onOpen) onOpen(apiObj);
  return apiObj;
}

/** 确认对话框 */
export function confirmDialog({
  title = t('common.confirmDeleteTitle'),
  desc = t('common.confirmDeleteDesc'),
  confirmText = t('common.confirm'),
  cancelText = t('common.cancel'),
  danger = true,
} = {}) {
  return new Promise((resolve) => {
    const modal = openModal({
      title,
      size: 'narrow',
      body: `<div class="text-secondary" style="font-size:13.2px;line-height:1.7">${desc}</div>`,
      footer: `
        <button class="btn btn-secondary" data-act="cancel">${escapeHtml(cancelText)}</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="ok">${escapeHtml(confirmText)}</button>`,
      onOpen(m) {
        m.el.querySelector('[data-act="cancel"]').addEventListener('click', () => { m.close(); resolve(false); });
        m.el.querySelector('[data-act="ok"]').addEventListener('click', () => { m.close(); resolve(true); });
      },
      onClose: () => resolve(false),
    });
  });
}

// ===========================================================================
// 表格 / 空状态 / 分页
// ===========================================================================

export function emptyState({ iconName = 'inbox', title = '', desc = '' } = {}) {
  return `
    <div class="empty">
      <div class="empty-icon">${icon(iconName, 26)}</div>
      <div class="empty-title">${escapeHtml(title || t('common.noData'))}</div>
      ${desc ? `<div class="empty-desc">${escapeHtml(desc)}</div>` : ''}
    </div>`;
}

export function badge(text, type = '') {
  return `<span class="badge ${type ? `badge-${type}` : ''}">${escapeHtml(text)}</span>`;
}

export function statusBadge(status) {
  const map = {
    active: ['common.active', 'success'],
    disabled: ['common.disabled', ''],
    success: ['common.success', 'success'],
    failed: ['common.failed', 'danger'],
    running: ['common.running', 'info'],
    pending: ['common.pending', 'warning'],
    cancelled: ['common.disabled', ''],
  };
  const [key, type] = map[status] || [status, ''];
  return badge(t(key), type);
}

/**
 * 简易分页组件
 * @param {{page:number,totalPages:number,total:number,pageSize:number}} data
 */
export function pagination(data) {
  const { page = 1, totalPages = 1, total = 0, pageSize = 15 } = data || {};
  const pages = [];
  const push = (p) => pages.push(p);
  const window = 2;
  for (let i = 1; i <= totalPages; i += 1) {
    if (i === 1 || i === totalPages || Math.abs(i - page) <= window) push(i);
    else if (pages[pages.length - 1] !== '...') push('...');
  }
  return `
    <div class="pagination">
      <div class="info">${t('common.total')} <b>${formatNumber(total)}</b> ${t('common.items')} · ${t('common.pageOf', { page, total: totalPages })}</div>
      <div class="pages">
        <button class="page-btn" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>${icon('chevronLeft', 14)}</button>
        ${pages.map((p) => (p === '...'
          ? '<span class="text-muted" style="padding:0 4px">…</span>'
          : `<button class="page-btn ${p === page ? 'active' : ''}" data-page="${p}">${p}</button>`)).join('')}
        <button class="page-btn" data-page="${page + 1}" ${page >= totalPages ? 'disabled' : ''}>${icon('chevronRight', 14)}</button>
      </div>
    </div>`;
}

/** 通用行内操作按钮 */
export function actionBtn(action, id, iconName, title, cls = 'btn-ghost') {
  return `<button class="btn btn-sm ${cls}" data-action="${action}" data-id="${id}" title="${escapeHtml(title)}">${icon(iconName, 15)}</button>`;
}

/** 复制到剪贴板 */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(String(text));
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = String(text);
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch { /* noop */ }
    ta.remove();
    return true;
  }
}
