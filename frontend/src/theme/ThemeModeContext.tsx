import { createContext, useContext } from 'react';
import { defaultThemeMode, type ThemeMode } from './themeMode';

interface ThemeModeContextValue {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
}

export const ThemeModeContext = createContext<ThemeModeContextValue>({
  mode: defaultThemeMode,
  setMode: () => undefined,
});

export function useThemeMode() {
  return useContext(ThemeModeContext);
}
