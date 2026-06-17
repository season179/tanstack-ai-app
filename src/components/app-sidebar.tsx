import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  BookOpen,
  CalendarClock,
  Check,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { isMobileViewport, useAppShell } from "~/components/app-shell-context";
import { ThemeToggle } from "~/components/theme-toggle";
import { Button } from "~/components/ui/button";
import { useChatBusy } from "~/lib/hooks/use-chat-busy";
import { type SessionSummary, useChatSessions } from "~/lib/hooks/use-chat-sessions";
import { cn } from "~/lib/utils";

const NAV_ITEMS = [
  { to: "/", icon: MessageSquare, label: "Chat" },
  { to: "/tasks", icon: CalendarClock, label: "Scheduled tasks" },
  { to: "/skills", icon: BookOpen, label: "Skills" },
] as const;

/** `/chat/<id>` → <id>; everything else → null (no active session highlight). */
function parseActiveSessionId(pathname: string): string | null {
  const match = pathname.match(/^\/chat\/([^/]+)$/);
  return match?.[1] ?? null;
}

function formatRelative(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) {
    return "";
  }
  const minutes = Math.round((Date.now() - then) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(then).toLocaleDateString();
}

type SessionGroup = {
  label: string;
  items: SessionSummary[];
};

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Partition the already-sorted (newest-first) list into Today / Older, keeping
 * order within each group. Matches the reference's sidebar grouping so a long
 * session history stays navigable: today's chats float under a clear label and
 * older ones collapse into a second section instead of one long flat list.
 */
function groupSessions(sessions: SessionSummary[]): SessionGroup[] {
  const now = new Date();
  const today: SessionSummary[] = [];
  const older: SessionSummary[] = [];

  for (const session of sessions) {
    const stamp = new Date(session.updatedAt || session.createdAt);
    if (isSameDay(stamp, now)) {
      today.push(session);
    } else {
      older.push(session);
    }
  }

  return [
    { label: "Today", items: today },
    { label: "Older", items: older },
  ].filter((group) => group.items.length > 0);
}

export function AppSidebar() {
  // Read from the module-level busy signal (not the per-session
  // ChatShellProvider, which lives below the sidebar in the tree) so the
  // sidebar can guard against tearing down an in-flight stream.
  const chatBusy = useChatBusy();
  const { sidebarOpen: open, toggleSidebar, closeSidebar } = useAppShell();
  const location = useRouterState({ select: (state) => state.location });
  const navigate = useNavigate();
  const { sessions, createSession, removeSession, renameSession } = useChatSessions();

  const activeSessionId = parseActiveSessionId(location.pathname);
  const groups = useMemo(() => groupSessions(sessions), [sessions]);

  function goToSession(id: string) {
    // Don't navigate away from the chat that is actively streaming: switching
    // remounts ChatSurface (keyed by sessionId) and would tear down the live
    // turn. Navigating back to the already-active chat is a no-op and safe.
    if (chatBusy && id !== activeSessionId) {
      return;
    }
    void navigate({ to: "/chat/$sessionId", params: { sessionId: id } });
    if (isMobileViewport()) {
      closeSidebar();
    }
  }

  function handleNewChat() {
    // Mirrors the reference's startNewSession chatBusy guard: a new chat
    // navigates and would remount ChatSurface mid-stream.
    if (chatBusy) {
      return;
    }
    const id = createSession();
    goToSession(id);
  }

  function handleDeleteSession(id: string, title: string) {
    // Can't delete the chat that is actively streaming — it would remount/
    // tear down the live ChatSurface and lose the in-flight turn (mirrors the
    // shell guard). Deleting any other (non-streaming) chat is fine.
    if (chatBusy && id === activeSessionId) {
      return;
    }
    if (!window.confirm(`Delete '${title}'? This removes it from this browser.`)) {
      return;
    }
    removeSession(id);
    if (id === activeSessionId) {
      // Bounce to "/", which redirects to the next-most-recent (or a fresh) chat.
      void navigate({ to: "/", replace: true });
    }
  }

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
              const isActive =
                item.to === "/"
                  ? pathname === "/" || pathname.startsWith("/chat")
                  : pathname.startsWith(item.to);
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
              aria-label="New chat"
              className={open ? "w-full justify-start gap-2" : "mx-auto size-9"}
              disabled={chatBusy}
              onClick={handleNewChat}
              size={open ? "sm" : "icon"}
              title={open ? undefined : "New chat"}
              type="button"
              variant="outline"
            >
              <Plus className="size-4" />
              {open ? "New chat" : null}
            </Button>
            <ThemeToggle withLabel={open} />
          </div>

          {open ? (
            <nav aria-label="Chats" className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
              {sessions.length === 0 ? (
                <p className="px-2 py-3 text-xs text-muted-foreground">
                  No chats yet. Click <span className="font-medium">New chat</span> to start.
                </p>
              ) : (
                groups.map((group) => (
                  <div className="mb-3" key={group.label}>
                    <p className="px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      {group.label}
                    </p>
                    <ul className="space-y-0.5">
                      {group.items.map((session) => (
                        <SessionRow
                          busy={chatBusy}
                          isActive={session.id === activeSessionId}
                          key={session.id}
                          onDelete={handleDeleteSession}
                          onRename={renameSession}
                          onSelect={goToSession}
                          session={session}
                        />
                      ))}
                    </ul>
                  </div>
                ))
              )}
            </nav>
          ) : null}
        </aside>
      </div>
    </>
  );
}

type SessionRowProps = {
  session: SessionSummary;
  isActive: boolean;
  busy: boolean;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string, title: string) => void;
};

/**
 * One chat in the sidebar: an inline-renameable row. The editing state lives
 * here (not in the parent) so only the row being renamed re-renders on each
 * keystroke. Commit on Enter/blur, cancel on Escape; a no-op commit (blank or
 * unchanged) leaves the stored title alone.
 */
function SessionRow({ session, isActive, busy, onSelect, onRename, onDelete }: SessionRowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  function startEditing() {
    setDraft(session.title);
    setEditing(true);
  }

  function commit() {
    const next = draft.trim();
    setEditing(false);
    if (next && next !== session.title) {
      onRename(session.id, next);
    }
  }

  if (editing) {
    return (
      <li>
        <div className="flex items-center gap-1 rounded-md bg-muted px-2 py-1">
          <input
            aria-label="Rename chat"
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none"
            maxLength={80}
            onBlur={commit}
            onChange={(event) => setDraft(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commit();
              } else if (event.key === "Escape") {
                event.preventDefault();
                setEditing(false);
              }
            }}
            ref={inputRef}
            value={draft}
          />
          <button
            aria-label="Save name"
            className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground"
            // onMouseDown (not onClick) so it fires before the input's onBlur cancels.
            onMouseDown={(event) => {
              event.preventDefault();
              commit();
            }}
            type="button"
          >
            <Check className="size-3.5" />
          </button>
        </div>
      </li>
    );
  }

  return (
    <li
      aria-current={isActive ? "true" : undefined}
      className={cn(
        "group relative flex items-center rounded-md pr-1 outline-none transition-colors focus-within:ring-2 focus-within:ring-primary/30",
        isActive ? "bg-muted" : "hover:bg-muted/60",
      )}
    >
      <button
        className={cn(
          "min-w-0 flex-1 py-2 pl-2.5 pr-7 text-left",
          isActive ? "text-foreground" : "text-muted-foreground",
        )}
        disabled={busy && !isActive}
        onClick={() => onSelect(session.id)}
        title={session.title}
        type="button"
      >
        <span className="flex items-center gap-2">
          <MessageSquare
            aria-hidden="true"
            className={cn("size-3.5 shrink-0", isActive && "text-primary")}
          />
          <span className={cn("truncate text-sm", isActive && "font-medium text-foreground")}>
            {session.title}
          </span>
        </span>
        {session.updatedAt ? (
          <span className="mt-0.5 block pl-5.5 text-[11px] text-muted-foreground/80">
            {formatRelative(session.updatedAt)}
          </span>
        ) : null}
      </button>
      <div className="flex shrink-0 items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        <Button
          aria-label={`Rename ${session.title}`}
          className="size-7 text-muted-foreground hover:text-foreground"
          onClick={startEditing}
          size="icon"
          title="Rename chat"
          type="button"
          variant="ghost"
        >
          <Pencil className="size-3.5" />
        </Button>
        <Button
          aria-label={`Delete ${session.title}`}
          className="size-7 text-muted-foreground hover:text-destructive disabled:cursor-not-allowed disabled:opacity-40"
          disabled={busy && isActive}
          onClick={() => onDelete(session.id, session.title)}
          size="icon"
          title="Delete chat"
          type="button"
          variant="ghost"
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </li>
  );
}
