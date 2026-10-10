/**
 * 个人资料：基本信息 / 外观 / 密码 / 登录设备
 */
import { t, LOCALES, getLocale, setLocale } from '../i18n.js';
import { THEMES, ACCENTS, getTheme, getAccent, applyTheme, applyAccent } from '../theme.js';
import { api, post, put, del } from '../api.js';
import {
  icon, escapeHtml, formatDate, timeAgo, toastSuccess, toastError, confirmDialog,
} from '../ui.js';

export async function renderProfile({ container, state, refresh }) {
  const $ = (sel) => container.querySelector(sel);
  const user = state.user;

  container.innerHTML = `
    <div class="grid-2">

      <!-- 基本信息 -->
      <section class="card">
        <div class="card-header">
          <div class="card-title">${icon('user', 17)} ${escapeHtml(t('profile.basic'))}</div>
        </div>
        <div class="card-body">
          <div class="flex items-center gap-4 mb-4">
            <div class="avatar lg">${escapeHtml((user.displayName || user.username || 'U').slice(0, 1).toUpperCase())}</div>
            <div>
              <div style="font-size:17px;font-weight:680">${escapeHtml(user.displayName || user.username)}</div>
              <div class="text-sm text-muted">@${escapeHtml(user.username)}</div>
              <div class="flex gap-2 mt-2">
                <span class="badge badge-primary">${escapeHtml(user.role || 'admin')}</span>
                <span class="badge ${user.status === 'active' ? 'badge-success' : ''}">${escapeHtml(user.status === 'active' ? t('common.active') : t('common.disabled'))}</span>
              </div>
            </div>
          </div>

          <form id="profileForm">
            <div class="field">
              <label class="field-label">${escapeHtml(t('profile.account'))}</label>
              <input class="input" name="username" maxlength="32" value="${escapeHtml(user.username)}" />
              <div class="field-hint">${escapeHtml(t('profile.usernameRule'))}</div>
            </div>
            <div class="field">
              <label class="field-label">${escapeHtml(t('profile.displayName'))}</label>
              <input class="input" name="displayName" maxlength="64" value="${escapeHtml(user.displayName || '')}" />
            </div>
            <div class="field">
              <label class="field-label">${escapeHtml(t('profile.email'))}</label>
              <input class="input" name="email" type="email" maxlength="128" value="${escapeHtml(user.email || '')}" />
            </div>
            <div class="field">
              <label class="field-label">${escapeHtml(t('profile.bio'))}</label>
              <textarea class="textarea" name="bio" maxlength="500">${escapeHtml(user.bio || '')}</textarea>
            </div>
            <button class="btn btn-primary" id="saveProfileBtn" type="button">${icon('check', 15)} ${escapeHtml(t('common.save'))}</button>
          </form>

          <div class="divider"></div>
          <dl class="desc-list">
            <dt>${escapeHtml(t('profile.createdAt'))}</dt><dd>${escapeHtml(formatDate(user.createdAt))}</dd>
            <dt>${escapeHtml(t('profile.lastLogin'))}</dt>
            <dd>${escapeHtml(formatDate(user.lastLoginAt))} ${user.lastLoginIp ? `<span class="text-muted text-xs">(${escapeHtml(user.lastLoginIp)})</span>` : ''}</dd>
          </dl>
        </div>
      </section>

      <div class="flex flex-col gap-4">

        <!-- 外观 -->
        <section class="card">
          <div class="card-header">
            <div class="card-title">${icon('sliders', 17)} ${escapeHtml(t('profile.appearance'))}</div>
          </div>
          <div class="card-body">
            <div class="field">
              <label class="field-label">${escapeHtml(t('lang.label'))}</label>
              <select class="select" id="localeSelect">
                ${LOCALES.map((l) => `<option value="${l.id}" ${l.id === getLocale() ? 'selected' : ''}>${l.flag} ${escapeHtml(l.label)}</option>`).join('')}
              </select>
            </div>

            <div class="field">
              <label class="field-label">${escapeHtml(t('theme.title'))}</label>
              <div class="theme-grid" id="themeGrid">
                ${THEMES.map((th) => `
                  <div class="theme-card ${th.id === getTheme() ? 'active' : ''}" data-theme-id="${th.id}">
                    <div class="theme-preview">
                      ${th.swatches.map((c) => `<div class="sw" style="background:${c}"></div>`).join('')}
                    </div>
                    <div class="theme-name">${escapeHtml(t(th.nameKey))}</div>
                    <div class="theme-desc">${escapeHtml(t(th.descKey))}</div>
                  </div>`).join('')}
              </div>
            </div>

            <div class="field">
              <label class="field-label">${escapeHtml(t('theme.accent'))}</label>
              <div class="accent-grid" id="accentGrid">
                ${ACCENTS.map((a) => `
                  <div class="accent-dot ${a.id === getAccent() ? 'active' : ''}" data-accent="${a.id}"
                       style="background:${a.color}" title="${escapeHtml(a.id)}"></div>`).join('')}
              </div>
            </div>
          </div>
        </section>

        <!-- 密码 -->
        <section class="card" id="secPassword">
          <div class="card-header">
            <div class="card-title">${icon('lock', 17)} ${escapeHtml(t('profile.changePassword'))}</div>
          </div>
          <div class="card-body">
            <form id="pwdForm">
              <div class="field">
                <label class="field-label">${escapeHtml(t('profile.oldPassword'))}<span class="req">*</span></label>
                <input class="input" name="oldPassword" type="password" required autocomplete="current-password" />
              </div>
              <div class="field">
                <label class="field-label">${escapeHtml(t('profile.newPassword'))}<span class="req">*</span></label>
                <input class="input" name="newPassword" type="password" required minlength="6" autocomplete="new-password" />
              </div>
              <div class="field">
                <label class="field-label">${escapeHtml(t('profile.confirmPassword'))}<span class="req">*</span></label>
                <input class="input" name="confirmPassword" type="password" required minlength="6" autocomplete="new-password" />
              </div>
              <button class="btn btn-primary" id="savePwdBtn" type="button">${icon('check', 15)} ${escapeHtml(t('profile.changePassword'))}</button>
            </form>
          </div>
        </section>
      </div>
    </div>

    <!-- 登录设备 -->
    <section class="card mt-4">
      <div class="card-header">
        <div>
          <div class="card-title">${icon('shield', 17)} ${escapeHtml(t('profile.sessions'))}</div>
          <div class="card-subtitle">${escapeHtml(t('dashboard.sessionInfo', { n: 7 }))}</div>
        </div>
        <button class="btn btn-danger-ghost btn-sm" id="revokeBtn">${icon('logout', 15)} ${escapeHtml(t('profile.revokeOthers'))}</button>
      </div>
      <div class="card-body" id="sessionBox">
        <div class="empty"><div class="spinner"></div><div class="empty-title">${escapeHtml(t('common.loading'))}</div></div>
      </div>
    </section>`;

  // ── 保存资料 ─────────────────────────────────────────────────────────
  $('#saveProfileBtn').addEventListener('click', async () => {
    const form = $('#profileForm');
    const body = Object.fromEntries(new FormData(form).entries());
    const btn = $('#saveProfileBtn');
    btn.classList.add('btn-loading');
    try {
      const res = await put('/api/auth/profile', body);
      state.user = res.user;
      toastSuccess(t('common.saveSuccess'));
      refresh();
    } catch (e) {
      toastError(e.message);
    } finally {
      btn.classList.remove('btn-loading');
    }
  });

  // ── 外观 ─────────────────────────────────────────────────────────────
  $('#localeSelect').addEventListener('change', async (e) => {
    setLocale(e.target.value);
    await put('/api/auth/profile', { locale: e.target.value }).catch(() => {});
    refresh();
  });

  container.querySelectorAll('[data-theme-id]').forEach((el) => {
    el.addEventListener('click', async () => {
      applyTheme(el.dataset.themeId, undefined);
      await put('/api/auth/profile', { theme: getTheme() }).catch(() => {});
      container.querySelectorAll('[data-theme-id]').forEach((x) => x.classList.toggle('active', x === el));
    });
  });

  container.querySelectorAll('[data-accent]').forEach((el) => {
    el.addEventListener('click', async () => {
      applyAccent(el.dataset.accent);
      await put('/api/auth/profile', { accent: getAccent() }).catch(() => {});
      container.querySelectorAll('[data-accent]').forEach((x) => x.classList.toggle('active', x === el));
    });
  });

  // ── 修改密码 ─────────────────────────────────────────────────────────
  $('#savePwdBtn').addEventListener('click', async () => {
    const form = $('#pwdForm');
    const body = Object.fromEntries(new FormData(form).entries());
    if (body.newPassword !== body.confirmPassword) {
      toastError(t('profile.passwordMismatch'));
      return;
    }
    if (String(body.newPassword).length < 6) {
      toastError(t('profile.passwordTooShort'));
      return;
    }
    const btn = $('#savePwdBtn');
    btn.classList.add('btn-loading');
    try {
      await post('/api/auth/password', body);
      toastSuccess(t('profile.passwordChanged'));
      form.reset();
    } catch (e) {
      toastError(e.message);
    } finally {
      btn.classList.remove('btn-loading');
    }
  });

  // ── 登录设备 ─────────────────────────────────────────────────────────
  async function loadSessions() {
    const box = $('#sessionBox');
    try {
      const res = await api('/api/auth/sessions');
      const list = res.list || [];
      if (!list.length) {
        box.innerHTML = `<div class="text-muted text-sm">${escapeHtml(t('common.noData'))}</div>`;
        return;
      }
      box.innerHTML = `
        <div class="flex flex-col gap-2">
          ${list.map((s) => `
            <div class="flex items-center gap-3" style="padding:11px 13px;border:1px solid var(--border);border-radius:var(--radius-md)">
              <div class="stat-icon icon-chip-slate" style="width:32px;height:32px;border-radius:9px;display:grid;place-items:center">${icon('server', 16)}</div>
              <div style="flex:1;min-width:0">
                <div class="flex items-center gap-2">
                  <span class="text-sm" style="font-weight:600">${escapeHtml(s.ip || t('common.unknown'))}</span>
                  ${s.current ? `<span class="badge badge-success">${escapeHtml(t('profile.currentDevice'))}</span>` : ''}
                </div>
                <div class="text-xs text-muted truncate" style="max-width:520px">${escapeHtml(s.userAgent || '')}</div>
                <div class="text-xs text-muted">${escapeHtml(t('common.lastSync'))}: ${escapeHtml(formatDate(s.lastSeen))} · ${escapeHtml(timeAgo(s.lastSeen))}</div>
              </div>
              <code class="text-xs text-muted">${escapeHtml(s.hint || '')}…</code>
            </div>`).join('')}
        </div>`;
    } catch (e) {
      box.innerHTML = `<div class="text-danger text-sm">${escapeHtml(e.message)}</div>`;
    }
  }

  $('#revokeBtn').addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: t('profile.revokeOthers'),
      desc: t('common.confirmDeleteDesc'),
      confirmText: t('profile.revokeOthers'),
    });
    if (!ok) return;
    try {
      await del('/api/auth/sessions');
      toastSuccess(t('profile.revokeDone'));
      loadSessions();
    } catch (e) {
      toastError(e.message);
    }
  });

  await loadSessions();
}
