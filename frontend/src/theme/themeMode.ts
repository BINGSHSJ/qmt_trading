export type ThemeMode = 'dark' | 'light';

export const defaultThemeMode: ThemeMode = 'dark';

export const THEME_MODE_STORAGE_KEY = 'lqc_theme_mode';

const THEME_COLOR_META: Record<ThemeMode, string> = {
  dark: '#0b0f14',
  light: '#edf2f8',
};

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'dark' || value === 'light';
}

export function getStoredThemeMode(): ThemeMode {
  if (typeof window === 'undefined') return defaultThemeMode;
  try {
    const stored = window.localStorage.getItem(THEME_MODE_STORAGE_KEY);
    return isThemeMode(stored) ? stored : defaultThemeMode;
  } catch {
    return defaultThemeMode;
  }
}

export function setStoredThemeMode(mode: ThemeMode) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(THEME_MODE_STORAGE_KEY, mode);
  } catch {
    // localStorage may be blocked in restricted browser profiles.
  }
}

export function applyThemeMode(mode: ThemeMode) {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = mode;
  document.documentElement.style.colorScheme = mode;
  syncThemeColorMeta(mode);
}

function syncThemeColorMeta(mode: ThemeMode) {
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  meta.content = THEME_COLOR_META[mode];
}
