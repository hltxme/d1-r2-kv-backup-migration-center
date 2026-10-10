/**
 * 主题系统 · 主题注册表 + 应用
 *
 * ⚠️ 新增主题只需两步：
 *   1. 在 public/css/tokens.css 里加一个 [data-theme="your-id"] 块
 *   2. 在下面的 THEMES 数组里登记（id 必须一致）
 */
export const THEMES = [
  {
    id: 'light',
    nameKey: 'theme.light',
    descKey: 'theme.lightDesc',
    swatches: ['#ffffff', '#f5f7fb', '#e6eaf2', '#4f46e5'],
  },
  {
    id: 'dark',
    nameKey: 'theme.dark',
    descKey: 'theme.darkDesc',
    swatches: ['#0b1120', '#131c31', '#26324d', '#6366f1'],
  },
  {
    id: 'aurora',
    nameKey: 'theme.aurora',
    descKey: 'theme.auroraDesc',
    swatches: ['#f2f1fb', '#ffffff', '#c4b5fd', '#7c3aed'],
  },
];

export const ACCENTS = [
  { id: 'indigo', color: '#4f46e5' },
  { id: 'blue', color: '#2563eb' },
  { id: 'cyan', color: '#0891b2' },
  { id: 'emerald', color: '#059669' },
  { id: 'amber', color: '#d97706' },
  { id: 'rose', color: '#e11d48' },
  { id: 'violet', color: '#7c3aed' },
  { id: 'slate', color: '#475569' },
];

const LS_THEME = 'bc.theme';
const LS_ACCENT = 'bc.accent';

let currentTheme = 'light';
let currentAccent = 'indigo';

function readLS(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeLS(key, value) {
  try { localStorage.setItem(key, value); } catch { /* noop */ }
}

export function getTheme() { return currentTheme; }
export function getAccent() { return currentAccent; }

export function isTheme(id) {
  return THEMES.some((x) => x.id === id);
}

export function applyTheme(id, accent) {
  const theme = isTheme(id) ? id : 'light';
  currentTheme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  writeLS(LS_THEME, theme);

  if (accent) {
    const valid = ACCENTS.some((a) => a.id === accent) ? accent : 'indigo';
    currentAccent = valid;
    document.documentElement.setAttribute('data-accent', valid);
    writeLS(LS_ACCENT, valid);
  }
  return currentTheme;
}

/** 切换浅/深（在 light ↔ dark 之间，aurora 视为浅色系） */
export function toggleTheme() {
  return applyTheme(currentTheme === 'dark' ? 'light' : 'dark');
}

export function applyAccent(id) {
  return applyTheme(currentTheme, id);
}

/**
 * 初始化主题
 * @param {string} fallbackTheme 服务端默认主题（未登录/首次访问时使用）
 * @param {string} fallbackAccent 服务端默认强调色
 */
export function initTheme(fallbackTheme = 'light', fallbackAccent = 'indigo') {
  const savedTheme = readLS(LS_THEME) || fallbackTheme || 'light';
  const savedAccent = readLS(LS_ACCENT) || fallbackAccent || 'indigo';
  return applyTheme(savedTheme, savedAccent);
}
