/**
 * React context for the theme. Works in React Native and on the web — this
 * module imports only `react`, never `react-native`.
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { themes, type Theme, type ThemeVariant } from './themes';

const ThemeContext = createContext<Theme>(themes.base);

export interface ThemeProviderProps {
  /** Pick a built-in variant… */
  variant?: ThemeVariant;
  /** …or supply a full theme object (wins over `variant`). */
  theme?: Theme;
  children: ReactNode;
}

export function ThemeProvider({ variant = 'base', theme, children }: ThemeProviderProps) {
  const value = useMemo<Theme>(() => theme ?? themes[variant], [theme, variant]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** The active theme. Defaults to the base variant when no provider is mounted. */
export function useTheme(): Theme {
  return useContext(ThemeContext);
}
