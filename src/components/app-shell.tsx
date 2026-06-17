import { type CSSProperties, type ReactNode, useEffect } from "react";
import {
  AppShellProvider,
  isMobileViewport,
  SIDEBAR_RAIL,
  SIDEBAR_WIDTH,
  useAppShell,
} from "~/components/app-shell-context";
import { AppSidebar } from "~/components/app-sidebar";

type SidebarStyle = CSSProperties & { "--sidebar-width": string; "--sidebar-rail": string };

/**
 * The app frame: a persistent full-height sidebar (nav + chat session list) plus
 * a content region for the routed page. It lives in the root layout so the
 * sidebar is constant across /, /tasks, and /skills. Each page reads shell state
 * via useAppShell().
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <AppShellProvider>
      <AppShellFrame>{children}</AppShellFrame>
    </AppShellProvider>
  );
}

function AppShellFrame({ children }: { children: ReactNode }) {
  const { sidebarOpen, closeSidebar } = useAppShell();

  // Default the sidebar closed on mobile on first mount. closeSidebar is a
  // stable callback (useCallback in the provider), so this runs once.
  useEffect(() => {
    if (isMobileViewport()) {
      closeSidebar();
    }
  }, [closeSidebar]);

  return (
    <div
      className="flex h-dvh overflow-hidden bg-background"
      style={
        {
          "--sidebar-rail": SIDEBAR_RAIL,
          "--sidebar-width": sidebarOpen ? SIDEBAR_WIDTH : SIDEBAR_RAIL,
        } as SidebarStyle
      }
    >
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">{children}</div>
    </div>
  );
}
