import { Link, useRouterState } from "@tanstack/react-router";
import {
  BookOpen,
  CalendarClock,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
} from "lucide-react";

import { isMobileViewport, useAppShell } from "~/components/app-shell-context";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

const NAV_ITEMS = [
  { to: "/", icon: MessageSquare, label: "Chat" },
  { to: "/tasks", icon: CalendarClock, label: "Scheduled tasks" },
  { to: "/skills", icon: BookOpen, label: "Skills" },
] as const;

export function AppSidebar() {
  const { sidebarOpen: open, toggleSidebar, closeSidebar } = useAppShell();
  const location = useRouterState({ select: (state) => state.location });

  return (
    <>
      {/* Mobile backdrop: tap-to-close while expanded; hidden once docked (sm+). */}
      {open ? (
        <button
          aria-label="Close sidebar"
          className="fixed inset-0 z-30 bg-foreground/20 backdrop-blur-[1px] sm:hidden"
          onClick={closeSidebar}
          type="button"
        />
      ) : null}

      <div className="relative w-[var(--sidebar-rail)] shrink-0 transition-[width] duration-200 ease-out sm:w-[var(--sidebar-width)]">
        <aside className="absolute inset-y-0 left-0 z-40 flex w-[var(--sidebar-width)] flex-col overflow-hidden border-r border-border bg-background shadow-xl transition-[width] duration-200 ease-out sm:shadow-none">
          <div className="flex items-center gap-2 px-2 py-3 sm:py-4">
            {open ? (
              <span className="pl-1 text-sm font-semibold text-foreground">TanStack AI App</span>
            ) : null}
            <Button
              aria-label={open ? "Collapse sidebar" : "Expand sidebar"}
              className={cn("size-9", open ? "ml-auto" : "mx-auto")}
              onClick={toggleSidebar}
              size="icon"
              type="button"
              variant="ghost"
            >
              {open ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
            </Button>
          </div>

          <nav aria-label="Primary" className="flex flex-col gap-0.5 px-2">
            {NAV_ITEMS.map((item) => {
              const pathname = location.pathname;
              const isActive = item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
              const Icon = item.icon;

              return (
                <Link
                  activeOptions={{ exact: item.to === "/" }}
                  activeProps={{}}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/30",
                    open ? "" : "justify-center",
                    isActive
                      ? "bg-muted font-medium text-foreground"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                  key={item.to}
                  onClick={() => {
                    if (isMobileViewport()) {
                      closeSidebar();
                    }
                  }}
                  title={open ? undefined : item.label}
                  to={item.to}
                >
                  <Icon className={cn("size-4 shrink-0", isActive && "text-primary")} />
                  {open ? <span className="truncate">{item.label}</span> : null}
                </Link>
              );
            })}
          </nav>

          <div className="mx-3 my-2 border-t border-border/70" />

          <div className="px-2 pb-2">
            <Button
              className={open ? "w-full justify-start gap-2" : "mx-auto size-9"}
              disabled
              size={open ? "sm" : "icon"}
              title={open ? undefined : "New chat"}
              type="button"
              variant="outline"
            >
              <Plus className="size-4" />
              {open ? "New chat" : null}
            </Button>
          </div>

          {open ? (
            <nav aria-label="Chats" className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
              <p className="px-2 py-3 text-xs text-muted-foreground">
                No chats yet. Streaming chat lands next.
              </p>
            </nav>
          ) : null}
        </aside>
      </div>
    </>
  );
}
