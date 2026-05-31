import { App as AntApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { DensityContext } from '../theme/DensityContext';
import {
  DISPLAY_DENSITY_STORAGE_KEY,
  applyDisplayDensity,
  getStoredDisplayDensity,
  isDisplayDensity,
  setStoredDisplayDensity,
  type DisplayDensity,
} from '../theme/density';
import { createAntdTheme } from '../theme/theme';
import { ThemeModeContext } from '../theme/ThemeModeContext';
import {
  THEME_MODE_STORAGE_KEY,
  applyThemeMode,
  getStoredThemeMode,
  isThemeMode,
  setStoredThemeMode,
  type ThemeMode,
} from '../theme/themeMode';

let themeSwitchTimer: number | undefined;
let themeSwitchFallbackTimer: number | undefined;

function unlockThemeTransition() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  delete document.documentElement.dataset.themeSwitching;
  if (themeSwitchTimer) {
    window.clearTimeout(themeSwitchTimer);
    themeSwitchTimer = undefined;
  }
  if (themeSwitchFallbackTimer) {
    window.clearTimeout(themeSwitchFallbackTimer);
    themeSwitchFallbackTimer = undefined;
  }
}

function lockThemeTransition() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const root = document.documentElement;
  root.dataset.themeSwitching = 'true';
  if (themeSwitchTimer) window.clearTimeout(themeSwitchTimer);
  if (themeSwitchFallbackTimer) window.clearTimeout(themeSwitchFallbackTimer);

  themeSwitchFallbackTimer = window.setTimeout(unlockThemeTransition, 1000);

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      themeSwitchTimer = window.setTimeout(unlockThemeTransition, 420);
    });
  });
}

export default function Root() {
  const [displayDensity, setDisplayDensity] = useState<DisplayDensity>(() => getStoredDisplayDensity());
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => getStoredThemeMode());
  const densityContext = useMemo(
    () => ({
      density: displayDensity,
      setDensity: (nextDensity: DisplayDensity) => {
        setStoredDisplayDensity(nextDensity);
        setDisplayDensity(nextDensity);
      },
    }),
    [displayDensity],
  );
  const themeModeContext = useMemo(
    () => ({
      mode: themeMode,
      setMode: (nextMode: ThemeMode) => {
        lockThemeTransition();
        applyThemeMode(nextMode);
        setStoredThemeMode(nextMode);
        setThemeMode(nextMode);
      },
    }),
    [themeMode],
  );

  useLayoutEffect(() => {
    applyDisplayDensity(displayDensity);
  }, [displayDensity]);

  useLayoutEffect(() => {
    applyThemeMode(themeMode);
  }, [themeMode]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === THEME_MODE_STORAGE_KEY && isThemeMode(event.newValue)) {
        setThemeMode(event.newValue);
      }
      if (event.key === DISPLAY_DENSITY_STORAGE_KEY && isDisplayDensity(event.newValue)) {
        setDisplayDensity(event.newValue);
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  return (
    <DensityContext.Provider value={densityContext}>
      <ThemeModeContext.Provider value={themeModeContext}>
        <ConfigProvider locale={zhCN} theme={createAntdTheme(displayDensity, themeMode)} button={{ autoInsertSpace: false }}>
          <AntApp>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </AntApp>
        </ConfigProvider>
      </ThemeModeContext.Provider>
    </DensityContext.Provider>
  );
}
