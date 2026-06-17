import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";

export const SIDEBAR_WIDTH = "16rem";
export const SIDEBAR_RAIL = "3.5rem";
export const MOBILE_QUERY = "(max-width: 639px)";

export function isMobileViewport(): boolean {
  return typeof window !== "undefined" && window.matchMedia(MOBILE_QUERY).matches;
}

/**
 * App-wide shell state. The sidebar is persistent across route changes (it lives
 * in the root layout), so its open/close state is owned here and survives nav.
 *
 * This is the seam that will later hold chat session state (active session,
 * session list, busy/usage) — kept deliberately small for the scaffold so the
 * chat runtime can drop in without touching the chrome.
 */
export type AppShellValue = {
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  closeSidebar: () => void;
};

const AppShellContext = createContext<AppShellValue | null>(null);

export function AppShellProvider({ children }: { children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Stable identities: the shell's mount effect and the sidebar both depend on
  // these without re-firing on every render.
  const toggleSidebar = useCallback(() => setSidebarOpen((open) => !open), []);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  const value = useMemo<AppShellValue>(
    () => ({ sidebarOpen, toggleSidebar, closeSidebar }),
    [sidebarOpen, toggleSidebar, closeSidebar],
  );

  return <AppShellContext value={value}>{children}</AppShellContext>;
}

export function useAppShell(): AppShellValue {
  const value = useContext(AppShellContext);
  if (!value) {
    throw new Error("useAppShell must be used inside <AppShellProvider>.");
  }
  return value;
}
