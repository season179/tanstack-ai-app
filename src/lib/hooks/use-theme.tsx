import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

/**
 * Framework-agnostic light/dark/system theme support, replacing the reference
 * app's next-themes dependency (this build has no next.js). Same contract:
 *   - `theme` is the STORED preference ("light" | "dark" | "system")
 *   - `resolvedTheme` is what's actually applied ("light" | "dark")
 *   - `attribute="class"` is emulated by toggling `.dark` on <html>
 *   - `defaultTheme="system"` follows the OS preference on first visit
 *
 * A no-flash inline script in __root.tsx sets the class before paint so the
 * first frame is already correct; this provider then keeps it in sync with the
 * stored preference and the live prefers-color-scheme media query (for the
 * `system` mode the class tracks the OS in real time).
 */

export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "theme";

type ThemeContextValue = {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (next: Theme) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

/** Returns the OS preference via the prefers-color-scheme media query ("light" when unavailable). */
export function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined" || !window.matchMedia) {
    return "light";
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Reads the stored preference from localStorage; defaults to "system". */
export function readStoredTheme(): Theme {
  if (typeof window === "undefined") {
    return "system";
  }
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (raw === "light" || raw === "dark" || raw === "system") {
      return raw;
    }
  } catch {
    // localStorage may be unavailable (private mode, disabled); fall through.
  }
  return "system";
}

/** Resolves a preference to the concrete light/dark value, consulting the OS media query for "system". */
export function resolveTheme(theme: Theme): ResolvedTheme {
  return theme === "system" ? getSystemTheme() : theme;
}

/** Applies the resolved theme to <html> by toggling the `.dark` class. */
export function applyTheme(resolved: ResolvedTheme) {
  if (typeof document === "undefined") {
    return;
  }
  const root = document.documentElement;
  if (resolved === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
}

type ThemeProviderProps = {
  children: ReactNode;
};

export function ThemeProvider({ children }: ThemeProviderProps) {
  // SSR renders "light" (no .dark class on <html>); the no-flash script corrects
  // the class before paint, and the mount effect syncs state to it.
  const [theme, setThemeState] = useState<Theme>("system");
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() => getSystemTheme());

  // On mount: read the stored preference, recompute the system theme against the
  // real media query, and apply. Runs once after hydration.
  useEffect(() => {
    const stored = readStoredTheme();
    setThemeState(stored);
    setSystemTheme(getSystemTheme());
    applyTheme(resolveTheme(stored));
  }, []);

  // Track the OS preference in real time so `system` mode follows it live.
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) {
      return;
    }
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (event: MediaQueryListEvent) => {
      const next: ResolvedTheme = event.matches ? "dark" : "light";
      setSystemTheme(next);
      if (theme === "system") {
        applyTheme(next);
      }
    };
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Ignore write failures (private mode, storage full); in-memory still works.
    }
    applyTheme(resolveTheme(next));
  }, []);

  const resolvedTheme: ResolvedTheme = theme === "system" ? systemTheme : theme;

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (ctx === null) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return ctx;
}
