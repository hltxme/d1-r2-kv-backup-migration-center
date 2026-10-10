/**
 * 控制台外壳：鉴权、侧边栏、路由、主题/语言切换
 */
import { t, initLocale, setLocale, getLocale, LOCALES, applyI18n } from './i18n.js';
import { THEMES, ACCENTS, initTheme, applyTheme, applyAccent, getTheme, getAccent } from './theme.js';
import { api, onUnauthorized, post } from './api.js';
import { icon, escapeHtml, toastSuccess, toastError, openModal, timeAgo } from './ui.js';

import { renderDashboard } from './pages/dashboard.js';
import { renderAccounts } from './pages/accounts.js';
import { createResourcePage } from './pages/resources.js';
import { renderTasks } from './pages/tasks.js';
import { renderProfile } from './pages/profile.js';

const $ = (sel, root = document) => root.querySelector(sel);

const ROUTES = {
  dashboard: { render: renderDashboard, titleKey: 'dashboard.title', descKey: 'dashboard.desc', icon: 'dashboard' },
  accounts: { render: renderAccounts, titleKey: 'accounts.title', descKey: 'accounts.desc', icon: 'cloud' },
  d1: { render: createResourcePage('d1'), titleKey: 'res.d1Title', descKey: 'res.d1Desc', icon: 'database' },
  r2: { render: createResourcePage('r2'), titleKey: 'res.r2Title', descKey: 'res.r2Desc', icon: 'bucket' },
  kv: { render: createResourcePage('kv'), titleKey: 'res.kvTitle', descKey: 'res.kvDesc', icon: 'key' },
  tasks: { render: renderTasks, titleKey: 'tasks.title', descKey: 'tasks.desc', icon: 'clock' },
  profile: { render: renderProfile, titleKey: 'profile.title', descKey: 'profile.desc', icon: 'user' },
};

const NAV = [
  { group: 'nav.groupResource', items: ['dashboard', 'accounts'] },
  { group: 'nav.groupSystem', items: ['d1', 'r2', 'kv', 'tasks'] },
  { group: 'nav.profile', items: ['profile'] },
];

export const state = {
  user: null,
  settings: null,
  route: 'dashboard',
  destroyed: false,
};

// ===========================================================================
// 鉴权
// ===========================================================================

onUnauthorized(() => {
  if (!location.pathname.includes('index.html') && location.pathname !== '/login') {
    location.href = '/index.html';
  }
});

async function loadMe() {
  const data = await api('/api/auth/me');
  state.user = data.user;
  return data.user;
}

// ===========================================================================
// 侧边栏
// ===========================================================================

function renderSidebar() {
  const nav = $('#sidebarNav');
  nav.innerHTML = NAV.map((section) => `
    <div class="nav-section">${escapeHtml(t(section.group))}</div>
    ${section.items.map((key) => {
      const route = ROUTES[key];
      return `
        <a class="nav-item ${state.route === key ? 'active' : ''}" href="#/${key}" data-route="${key}">
          ${icon(route.icon, 18)}
          <span class="nav-text">${escapeHtml(t(route.titleKey))}</span>
        </a>`;
    }).join('')}
  `).join('');

  nav.querySelectorAll('[data-route]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      navigate(el.dataset.route);
    });
  });

  const user = state.user || {};
  $('#sidebarUser').innerHTML = `
    <div class="avatar">${escapeHtml((user.displayName || user.username || 'U').slice(0, 1).toUpperCase())}</div>
    <div class="meta">
      <div class="uname">${escapeHtml(user.displayName || user.username || '')}</div>
      <div class="urole">${escapeHtml(user.role || 'admin')}</div>
    </div>`;
  $('#sidebarUser').onclick = () => navigate('profile');
}

function renderBrand() {
  const s = state.settings || {};
  $('#brandName').textContent = s.shortName || t('app.short');
  $('#brandVer').textContent = `v${s.version || '1.0.0'} · Cloudflare`;
  document.title = `${t(ROUTES[state.route]?.titleKey || 'app.short')} · ${s.shortName || t('app.short')}`;
}

// ===========================================================================
// 顶栏
// ===========================================================================

function renderTopbar() {
  const route = ROUTES[state.route] || ROUTES.dashboard;
  $('#pageTitle').textContent = t(route.titleKey);
  $('#pageDesc').textContent = t(route.descKey);
  $('#loadingText').textContent = t('common.loading');

  const actions = $('#topbarActions');
  actions.innerHTML = `
    <button class="btn btn-ghost btn-sm" id="refreshBtn">${icon('refresh', 15)}<span>${escapeHtml(t('common.refresh'))}</span></button>
    <div class="toggle-group" id="langToggle"></div>
    <button class="btn-icon" id="themeBtn" title="${escapeHtml(t('theme.title'))}">
      ${icon(getTheme() === 'dark' ? 'sun' : 'moon', 18)}
    </button>
    <div class="dropdown" id="userDrop">
      <button class="btn btn-secondary btn-sm" id="userDropBtn">
        <span class="avatar sm">${escapeHtml((state.user?.displayName || state.user?.username || 'U').slice(0, 1).toUpperCase())}</span>
        <span class="truncate" style="max-width:110px">${escapeHtml(state.user?.displayName || state.user?.username || '')}</span>
        ${icon('chevronDown', 14)}
      </button>
      <div class="dropdown-menu hidden" id="userDropMenu">
        <button class="dropdown-item" data-act="profile">${icon('user', 15)}<span>${escapeHtml(t('nav.profile'))}</span></button>
        <button class="dropdown-item" data-act="appearance">${icon('sliders', 15)}<span>${escapeHtml(t('profile.appearance'))}</span></button>
        <button class="dropdown-item" data-act="security">${icon('shield', 15)}<span>${escapeHtml(t('profile.security'))}</span></button>
        <div class="dropdown-divider"></div>
        <button class="dropdown-item danger" data-act="logout">${icon('logout', 15)}<span>${escapeHtml(t('nav.logout'))}</span></button>
      </div>
    </div>`;

  $('#refreshBtn').onclick = () => renderRoute(state.route, true);

  // 语言切换
  const langBox = $('#langToggle');
  langBox.innerHTML = LOCALES.map((l) => `
    <button class="tg-btn ${l.id === getLocale() ? 'active' : ''}" data-locale="${l.id}">${l.short}</button>`).join('');
  langBox.querySelectorAll('[data-locale]').forEach((btn) => {
    btn.onclick = () => {
      setLocale(btn.dataset.locale);
      api('/api/auth/profile', { method: 'PUT', body: { locale: btn.dataset.locale } }).catch(() => {});
      renderSidebar(); renderTopbar(); renderBrand(); renderRoute(state.route, true);
    };
  });

  $('#themeBtn').onclick = () => {
    applyTheme(getTheme() === 'dark' ? 'light' : 'dark');
    api('/api/auth/profile', { method: 'PUT', body: { theme: getTheme() } }).catch(() => {});
    renderTopbar();
    renderRoute(state.route, true);
  };

  // 用户下拉
  const menu = $('#userDropMenu');
  $('#userDropBtn').onclick = (e) => {
    e.stopPropagation();
    menu.classList.toggle('hidden');
  };
  document.addEventListener('click', () => menu.classList.add('hidden'));
  menu.querySelectorAll('[data-act]').forEach((el) => {
    el.onclick = () => {
      menu.classList.add('hidden');
      const act = el.dataset.act;
      if (act === 'profile') navigate('profile');
      if (act === 'appearance') openAppearanceModal();
      if (act === 'security') { navigate('profile'); setTimeout(() => $('#secPassword')?.scrollIntoView({ behavior: 'smooth' }), 260); }
      if (act === 'logout') doLogout();
    };
  });
}

async function doLogout() {
  try { await post('/api/auth/logout'); } catch { /* noop */ }
  location.href = '/index.html';
}

// ===========================================================================
// 路由
// ===========================================================================

export function navigate(route) {
  if (!ROUTES[route]) route = 'dashboard';
  if (location.hash !== `#/${route}`) {
    location.hash = `#/${route}`;
  } else {
    renderRoute(route, true);
  }
}

async function renderRoute(route, force = false) {
  if (!ROUTES[route]) route = 'dashboard';
  state.route = route;

  renderSidebar();
  renderTopbar();
  renderBrand();

  const content = $('#content');
  content.innerHTML = `
    <div class="empty" style="padding:110px 20px">
      <div class="spinner"></div>
      <div class="empty-title">${escapeHtml(t('common.loading'))}</div>
    </div>`;

  try {
    await ROUTES[route].render({
      container: content,
      state,
      navigate,
      refresh: () => renderRoute(state.route, true),
      api,
      t,
    });
  } catch (e) {
    if (e?.code === 'ERR_UNAUTHORIZED') return;
    content.innerHTML = `
      <div class="empty">
        <div class="empty-icon" style="color:var(--danger)">${icon('alert', 26)}</div>
        <div class="empty-title">${escapeHtml(t('common.loadFailed'))}</div>
        <div class="empty-desc">${escapeHtml(e?.message || '')}</div>
        <button class="btn btn-secondary mt-3" id="retryBtn">${escapeHtml(t('common.retry'))}</button>
      </div>`;
    $('#retryBtn')?.addEventListener('click', () => renderRoute(route, true));
    toastError(e?.message || t('common.loadFailed'));
  }
}

function handleHash() {
  const route = (location.hash || '#/dashboard').replace(/^#\/?/, '').split('?')[0] || 'dashboard';
  renderRoute(route);
}

// ===========================================================================
// 外观设置弹窗（主题 + 强调色）
// ===========================================================================

export function openAppearanceModal() {
  openModal({
    title: t('profile.appearance'),
    size: 'wide',
    body: `
      <div class="mb-3">
        <div class="field-label">${escapeHtml(t('theme.title'))}</div>
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
      <div class="divider"></div>
      <div>
        <div class="field-label">${escapeHtml(t('theme.accent'))}</div>
        <div class="accent-grid" id="accentGrid">
          ${ACCENTS.map((a) => `
            <div class="accent-dot ${a.id === getAccent() ? 'active' : ''}" data-accent="${a.id}"
                 style="background:${a.color}" title="${escapeHtml(a.id)}"></div>`).join('')}
        </div>
      </div>`,
    footer: `<button class="btn btn-primary" data-close>${escapeHtml(t('common.close'))}</button>`,
    onOpen(m) {
      m.el.querySelectorAll('[data-theme-id]').forEach((el) => {
        el.onclick = () => {
          applyTheme(el.dataset.themeId, undefined);
          api('/api/auth/profile', { method: 'PUT', body: { theme: getTheme() } }).catch(() => {});
          m.el.querySelectorAll('[data-theme-id]').forEach((x) => x.classList.toggle('active', x === el));
          renderTopbar();
        };
      });
      m.el.querySelectorAll('[data-accent]').forEach((el) => {
        el.onclick = () => {
          applyAccent(el.dataset.accent);
          api('/api/auth/profile', { method: 'PUT', body: { accent: getAccent() } }).catch(() => {});
          m.el.querySelectorAll('[data-accent]').forEach((x) => x.classList.toggle('active', x === el));
        };
      });
    },
  });
}

// ===========================================================================
// 启动
// ===========================================================================

async function boot() {
  try {
    const [user, settings] = await Promise.all([
      loadMe(),
      api('/api/settings').catch(() => null),
    ]);
    state.settings = settings;

    initLocale(user.locale || settings?.defaultLocale || 'zh-CN');
    initTheme(user.theme || settings?.defaultTheme || 'light', user.accent || settings?.defaultAccent || 'indigo');

    applyI18n(document);
    renderBrand();
    renderSidebar();

    $('#collapseBtn').onclick = () => $('#shell').classList.toggle('collapsed');

    window.addEventListener('hashchange', handleHash);
    handleHash();
  } catch (e) {
    if (e?.code === 'ERR_UNAUTHORIZED') return;
    $('#content').innerHTML = `
      <div class="empty">
        <div class="empty-icon" style="color:var(--danger)">${icon('alert', 26)}</div>
        <div class="empty-title">${escapeHtml(e?.message || t('common.loadFailed'))}</div>
        <button class="btn btn-secondary mt-3" onclick="location.href='/index.html'">${escapeHtml(t('nav.logout'))}</button>
      </div>`;
  }
}

document.addEventListener('DOMContentLoaded', boot);

// 供页面模块复用
export { api, toastSuccess, toastError, openModal, icon, escapeHtml, timeAgo };
