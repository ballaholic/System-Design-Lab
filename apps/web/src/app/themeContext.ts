import { createContext, useContext } from "react";

export type Theme = "dark" | "light" | "system";
export const THEME_STORAGE_KEY = "sdl-theme"; // also read by the inline script in index.html

export interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: "dark" | "light";
  setTheme: (theme: Theme) => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within ThemeProvider");
  return context;
}
