/**
 * 登录页逻辑
 */
import { t, initLocale, setLocale, getLocale, LOCALES, applyI18n } from './i18n.js';
import { THEMES, initTheme, applyTheme, getTheme } from './theme.js';
import { api, onUnauthorized } from './api.js';
import { escapeHtml, toastError, toastSuccess } from './ui.js';

const $ = (sel, root = document) => root.querySelector(sel);

let submitting = false;

// ── 主题 / 语言切换条 ───────────────────────────────────────────────────────
function renderToggles() {
  const langBox = $('#langToggle');
  langBox.innerHTML = LOCALES.map((l) => `
    <button class="tg-btn ${l.id === getLocale() ? 'active' : ''}" data-locale="${l.id}" title="${escapeHtml(l.label)}">
      ${l.flag} ${l.short}
    </button>`).join('');
  langBox.querySelectorAll('[data-locale]').forEach((btn) => {
    btn.addEventListener('click', () => {
      setLocale(btn.dataset.locale);
      renderToggles();
      applyI18n(document);
    });
  });

  const themeBox = $('#themeToggle');
  themeBox.innerHTML = THEMES.map((th) => `
    <button class="tg-btn ${th.id === getTheme() ? 'active' : ''}" data-theme-id="${th.id}" title="${escapeHtml(t('theme.switchTo', { name: t(th.nameKey) }))}">
      ${th.id === 'dark' ? '🌙' : th.id === 'aurora' ? '🌈' : '☀️'}
    </button>`).join('');
  themeBox.querySelectorAll('[data-theme-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      applyTheme(btn.dataset.themeId, undefined);
      renderToggles();
    });
  });
}

// ── 验证码 ─────────────────────────────────────────────────────────────────
function loadCaptcha() {
  const img = $('#captchaImg');
  if (!img) return;
  img.src = `/api/auth/captcha?t=${Date.now()}`;
}

// ── 错误提示 ───────────────────────────────────────────────────────────────
function showError(message) {
  const box = $('#loginError');
  box.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/></svg>
    <span>${escapeHtml(message)}</span>`;
  box.classList.remove('hidden');
}

function clearError() {
  const box = $('#loginError');
  box.classList.add('hidden');
  box.innerHTML = '';
}

// ── 提交 ───────────────────────────────────────────────────────────────────
async function handleSubmit(e) {
  e.preventDefault();
  if (submitting) return;
  clearError();

  const username = $('#username').value.trim();
  const password = $('#password').value;
  const captcha = $('#captcha').value.trim();

  if (!username) { showError(t('login.emptyUsername')); $('#username').focus(); return; }
  if (!password) { showError(t('login.emptyPassword')); $('#password').focus(); return; }
  if (!captcha) { showError(t('login.emptyCaptcha')); $('#captcha').focus(); return; }

  submitting = true;
  const btn = $('#submitBtn');
  btn.classList.add('btn-loading');
  btn.disabled = true;

  try {
    await api('/api/auth/login', {
      method: 'POST',
      body: { username, password, captcha, remember: $('#remember').checked },
    });
    toastSuccess(t('login.loginSuccess'));
    setTimeout(() => {
      window.location.href = '/app.html';
    }, 380);
  } catch (err) {
    const code = err?.code || '';
    let msg = err?.message || t('login.userPassError');
    if (code === 'ERR_CAPTCHA') msg = err.message || t('login.captchaError');
    if (code === 'ERR_UNAUTHORIZED') msg = t('login.userPassError');
    showError(msg);
    loadCaptcha();
    $('#captcha').value = '';
    $('#captcha').focus();
  } finally {
    submitting = false;
    btn.classList.remove('btn-loading');
    btn.disabled = false;
  }
}

// ── 初始化 ─────────────────────────────────────────────────────────────────
async function init() {
  let settings = null;
  try {
    settings = await api('/api/settings');
  } catch { /* 使用本地默认值 */ }

  initLocale(settings?.defaultLocale || 'zh-CN');
  initTheme(settings?.defaultTheme || 'light', settings?.defaultAccent || 'indigo');
  applyI18n(document);
  renderToggles();

  if (settings?.appName) {
    document.title = `${t('login.welcome')} · ${settings.shortName || settings.appName}`;
  }

  loadCaptcha();
  $('#captchaImg').addEventListener('click', loadCaptcha);
  $('#loginForm').addEventListener('submit', handleSubmit);
  $('#togglePwd').addEventListener('click', () => {
    const input = $('#password');
    input.type = input.type === 'password' ? 'text' : 'password';
    input.focus();
  });

  // 已登录则直接进入控制台
  try {
    await api('/api/auth/me');
    window.location.replace('/app.html');
  } catch { /* 未登录，正常 */ }
}

onUnauthorized(() => { /* 登录页无需跳转 */ });

document.addEventListener('DOMContentLoaded', init);
