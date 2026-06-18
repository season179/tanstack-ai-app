// @vitest-environment jsdom
//
// DOM-environment component tests for AppSidebar — the persistent left rail
// that holds the brand, primary nav (Chat / Scheduled tasks / Skills), the
// New chat affordance, the live chat-session list (Today/Older grouped), and
// the theme-toggle footer. Its pure grouping helpers (parseActiveSessionId /
// formatRelative / isSameDay / groupSessions — iteration 56), the
// sessions-store + useChatSessions hook reactivity (iteration 47/60), and the
// chat-busy signal (iteration 51) all have co-located coverage; the
// ThemeToggle footer is pinned (iteration 50/77). What had ZERO coverage was
// the AppSidebar component itself: its nav active-state derivation from the
// router pathname, the New chat / select / delete chatBusy guards + navigation
// wiring, the inline-rename row, the empty state, the rail-vs-expanded
// shapes, and the mobile backdrop / close-on-nav behavior.
//
// Harness: the router primitives (useRouterState/useNavigate/Link), the shell
// context (useAppShell/isMobileViewport), the busy hook (useChatBusy), the
// sessions hook (useChatSessions), and the ThemeToggle are mocked so the
// sidebar renders against controlled fixtures and pathname; the REAL
// sidebar-grouping helpers run on those fixtures — turning these into faithful
// integration tests of the pathname → active state / sessions → groups → rows
// / busy → guard pipeline.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppSidebar } from "~/components/app-sidebar";
import type { SessionSummary } from "~/lib/hooks/use-chat-sessions";

// vi.mock factories are hoisted before imports, so the shared fixtures +
// spies live in a hoisted object the factories read at call time. Individual
// tests reassign mocks.sessions / mocks.pathname / mocks.sidebarOpen /
// mocks.isMobile / mocks.busy and clear the action spies in beforeEach.
const mocks = vi.hoisted(() => ({
  pathname: "/",
  sidebarOpen: true,
  isMobile: false,
  busy: false,
  sessions: [] as SessionSummary[],
  navigate: vi.fn(),
  createSession: vi.fn(() => "new-session-id"),
  removeSession: vi.fn(),
  renameSession: vi.fn(),
  toggleSidebar: vi.fn(),
  closeSidebar: vi.fn(),
}));

// Mock the router primitives. Link renders a plain <a> carrying the `to` prop
// as href so active-class assertions work and clicking still fires onClick.
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    onClick,
    children,
    className,
    title,
    ...rest
  }: {
    to: string;
    onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
    children: React.ReactNode;
    className?: string;
    title?: string;
    [key: string]: unknown;
  }) => (
    <a
      data-testid="router-link"
      href={to}
      className={className}
      title={title}
      onClick={onClick}
      {...rest}
    >
      {children}
    </a>
  ),
  useRouterState: ({
    select,
  }: {
    select: (state: { location: { pathname: string } }) => unknown;
  }) => select({ location: { pathname: mocks.pathname } }),
  useNavigate: () => mocks.navigate,
}));

// Mock the shell context so each test controls sidebarOpen + the mobile flag
// + the toggle/close callbacks (stable spies).
vi.mock("~/components/app-shell-context", () => ({
  useAppShell: () => ({
    sidebarOpen: mocks.sidebarOpen,
    toggleSidebar: mocks.toggleSidebar,
    closeSidebar: mocks.closeSidebar,
  }),
  isMobileViewport: () => mocks.isMobile,
}));

vi.mock("~/lib/hooks/use-chat-busy", () => ({
  useChatBusy: () => mocks.busy,
}));

vi.mock("~/lib/hooks/use-chat-sessions", () => ({
  useChatSessions: () => ({
    sessions: mocks.sessions,
    createSession: mocks.createSession,
    removeSession: mocks.removeSession,
    renameSession: mocks.renameSession,
  }),
}));

// ThemeToggle is already pinned (iteration 50/77); stub it to a sentinel
// element so its internal matchMedia/localStorage machinery never runs.
vi.mock("~/components/theme-toggle", () => ({
  ThemeToggle: ({ withLabel }: { withLabel?: boolean }) => (
    <div data-testid="theme-toggle" data-with-label={withLabel ? "true" : "false"} />
  ),
}));

beforeEach(() => {
  mocks.pathname = "/";
  mocks.sidebarOpen = true;
  mocks.isMobile = false;
  mocks.busy = false;
  mocks.sessions = [];
  mocks.navigate.mockClear();
  mocks.createSession.mockClear();
  mocks.createSession.mockReturnValue("new-session-id");
  mocks.removeSession.mockClear();
  mocks.renameSession.mockClear();
  mocks.toggleSidebar.mockClear();
  mocks.closeSidebar.mockClear();
  // window.confirm defaults to true (the delete path); tests that exercise the
  // cancel path override it locally.
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// --- Fixtures --------------------------------------------------------------

function makeSession(overrides: Partial<SessionSummary>): SessionSummary {
  const now = Date.now();
  return {
    id: "s1",
    title: "My chat",
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    ...overrides,
  };
}

// A frozen clock makes the Today/Older grouping deterministic: sessions whose
// updatedAt is on the same calendar day land in Today, the rest in Older.
const NOW_MS = new Date("2024-06-01T12:00:00").getTime();

function sessionToday(id: string, title: string, minutesAgo = 5): SessionSummary {
  const updated = new Date(NOW_MS - minutesAgo * 60_000);
  return makeSession({
    id,
    title,
    createdAt: updated.toISOString(),
    updatedAt: updated.toISOString(),
  });
}

function sessionOlder(id: string, title: string): SessionSummary {
  // 3 days ago — guaranteed a different local calendar day from NOW.
  const updated = new Date(NOW_MS - 3 * 24 * 60 * 60_000);
  return makeSession({
    id,
    title,
    createdAt: updated.toISOString(),
    updatedAt: updated.toISOString(),
  });
}

describe("AppSidebar brand + collapse toggle", () => {
  it("renders the brand text and a collapse button when expanded", () => {
    mocks.sidebarOpen = true;
    render(<AppSidebar />);
    expect(screen.getByText("TanStack AI App")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Collapse sidebar" })).toBeTruthy();
  });

  it("hides the brand text and shows an expand button when collapsed (rail)", () => {
    mocks.sidebarOpen = false;
    render(<AppSidebar />);
    expect(screen.queryByText("TanStack AI App")).toBeNull();
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeTruthy();
  });

  it("calls toggleSidebar when the collapse/expand button is clicked", () => {
    render(<AppSidebar />);
    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(mocks.toggleSidebar).toHaveBeenCalledTimes(1);
  });
});

describe("AppSidebar primary nav", () => {
  it("renders the three nav items with labels when expanded", () => {
    render(<AppSidebar />);
    expect(screen.getByText("Chat")).toBeTruthy();
    expect(screen.getByText("Scheduled tasks")).toBeTruthy();
    expect(screen.getByText("Skills")).toBeTruthy();
  });

  it("hides nav labels (icon-only) when collapsed, surfacing them via title", () => {
    mocks.sidebarOpen = false;
    render(<AppSidebar />);
    expect(screen.queryByText("Chat")).toBeNull();
    expect(screen.queryByText("Scheduled tasks")).toBeNull();
    expect(screen.queryByText("Skills")).toBeNull();
    // The title attribute still carries the label for the icon-only rail.
    const chatLink = screen.getByTitle("Chat");
    expect(chatLink.getAttribute("href")).toBe("/");
  });

  it("marks Chat active on the index route", () => {
    mocks.pathname = "/";
    render(<AppSidebar />);
    const chatLink = screen.getByText("Chat").closest("a");
    expect(chatLink?.getAttribute("aria-current")).toBe("page");
    expect(chatLink?.className).toContain("bg-muted");
  });

  it("marks Chat active on a /chat/$sessionId route", () => {
    mocks.pathname = "/chat/abc-123";
    render(<AppSidebar />);
    const chatLink = screen.getByText("Chat").closest("a");
    expect(chatLink?.getAttribute("aria-current")).toBe("page");
  });

  it("marks Scheduled tasks active on /tasks", () => {
    mocks.pathname = "/tasks";
    render(<AppSidebar />);
    const tasksLink = screen.getByText("Scheduled tasks").closest("a");
    expect(tasksLink?.getAttribute("aria-current")).toBe("page");
    expect(screen.getByText("Chat").closest("a")?.getAttribute("aria-current")).toBeFalsy();
  });

  it("marks Skills active on /skills", () => {
    mocks.pathname = "/skills";
    render(<AppSidebar />);
    const skillsLink = screen.getByText("Skills").closest("a");
    expect(skillsLink?.getAttribute("aria-current")).toBe("page");
  });

  it("closes the sidebar on nav tap when the viewport is mobile", () => {
    mocks.isMobile = true;
    render(<AppSidebar />);
    fireEvent.click(screen.getByText("Skills"));
    expect(mocks.closeSidebar).toHaveBeenCalledTimes(1);
  });

  it("does not close the sidebar on nav tap on desktop", () => {
    mocks.isMobile = false;
    render(<AppSidebar />);
    fireEvent.click(screen.getByText("Skills"));
    expect(mocks.closeSidebar).not.toHaveBeenCalled();
  });
});

describe("AppSidebar New chat", () => {
  it("creates a session and navigates to it when clicked", () => {
    render(<AppSidebar />);
    fireEvent.click(screen.getByRole("button", { name: "New chat" }));
    expect(mocks.createSession).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/chat/$sessionId",
      params: { sessionId: "new-session-id" },
    });
  });

  it("is disabled and does nothing while a chat is streaming", () => {
    mocks.busy = true;
    render(<AppSidebar />);
    const button = screen.getByRole("button", { name: "New chat" });
    expect(button.hasAttribute("disabled")).toBe(true);
    fireEvent.click(button);
    expect(mocks.createSession).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("renders icon-only (no label) and with a title when collapsed", () => {
    mocks.sidebarOpen = false;
    render(<AppSidebar />);
    expect(screen.queryByText("New chat")).toBeNull();
    const button = screen.getByTitle("New chat");
    expect(button.tagName).toBe("BUTTON");
  });
});

describe("AppSidebar session list", () => {
  it("renders the empty state when there are no sessions", () => {
    render(<AppSidebar />);
    expect(screen.getByText(/No chats yet/i)).toBeTruthy();
    expect(screen.queryByText("Today")).toBeNull();
  });

  it("groups sessions into Today and Older by calendar day", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW_MS);
    try {
      mocks.sessions = [
        sessionOlder("s-old", "Last week chat"),
        sessionToday("s-new", "Fresh chat", 3),
      ];
      render(<AppSidebar />);
      const today = screen.getByText("Today").closest("div");
      const older = screen.getByText("Older").closest("div");
      expect(today).toBeTruthy();
      expect(older).toBeTruthy();
      expect(within(today as HTMLElement).getByText("Fresh chat")).toBeTruthy();
      expect(within(older as HTMLElement).getByText("Last week chat")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders only the Today header when no sessions are older", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW_MS);
    try {
      mocks.sessions = [sessionToday("s1", "Fresh chat", 3)];
      render(<AppSidebar />);
      expect(screen.getByText("Today")).toBeTruthy();
      expect(screen.queryByText("Older")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders a relative timestamp under each session title", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW_MS);
    try {
      mocks.sessions = [sessionToday("s1", "Fresh chat", 5)];
      render(<AppSidebar />);
      // formatRelative: 5m ago → "5m ago"
      expect(screen.getByText("5m ago")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks the session matching the active /chat/<id> pathname active", () => {
    mocks.pathname = "/chat/s-new";
    mocks.sessions = [sessionToday("s-new", "Active chat"), sessionToday("s-other", "Other")];
    render(<AppSidebar />);
    // aria-current lives on the row <li> (the select target is the inner
    // button, but the active flag is hoisted to the list item).
    const activeRow = screen.getByText("Active chat").closest("li");
    expect(activeRow?.getAttribute("aria-current")).toBe("true");
    const otherRow = screen.getByText("Other").closest("li");
    expect(otherRow?.getAttribute("aria-current")).toBeFalsy();
  });
});

describe("AppSidebar session row actions", () => {
  it("navigates to the session when its row is clicked", () => {
    mocks.sessions = [sessionToday("s1", "Pick me")];
    render(<AppSidebar />);
    fireEvent.click(screen.getByText("Pick me"));
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/chat/$sessionId",
      params: { sessionId: "s1" },
    });
  });

  it("does not navigate when selecting the active session during a stream (no-op back to active)", () => {
    mocks.busy = true;
    mocks.pathname = "/chat/s1";
    mocks.sessions = [sessionToday("s1", "Streaming chat")];
    render(<AppSidebar />);
    fireEvent.click(screen.getByText("Streaming chat"));
    // Navigating back to the already-active chat is allowed as a no-op.
    expect(mocks.navigate).toHaveBeenCalledTimes(1);
  });

  it("blocks navigation away from the active chat during a stream", () => {
    mocks.busy = true;
    mocks.pathname = "/chat/s1";
    mocks.sessions = [sessionToday("s1", "Streaming"), sessionToday("s2", "Other")];
    render(<AppSidebar />);
    fireEvent.click(screen.getByText("Other"));
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("reveals rename + delete affordances via title attribute", () => {
    mocks.sessions = [sessionToday("s1", "Editable")];
    render(<AppSidebar />);
    expect(screen.getByTitle("Rename chat")).toBeTruthy();
    expect(screen.getByTitle("Delete chat")).toBeTruthy();
  });

  it("enters edit mode and commits a rename via the Check button", () => {
    mocks.sessions = [sessionToday("s1", "Old name")];
    render(<AppSidebar />);
    fireEvent.click(screen.getByTitle("Rename chat"));
    const input = screen.getByLabelText("Rename chat") as HTMLInputElement;
    expect(input.value).toBe("Old name");
    fireEvent.change(input, { target: { value: "New name" } });
    // onMouseDown (not onClick) so it fires before blur cancels.
    fireEvent.mouseDown(screen.getByLabelText("Save name"));
    expect(mocks.renameSession).toHaveBeenCalledWith("s1", "New name");
  });

  it("commits a rename on Enter and cancels on Escape", () => {
    mocks.sessions = [sessionToday("s1", "Old name")];
    render(<AppSidebar />);
    fireEvent.click(screen.getByTitle("Rename chat"));
    const input = screen.getByLabelText("Rename chat") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Renamed" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(mocks.renameSession).toHaveBeenCalledWith("s1", "Renamed");
  });

  it("does not call rename when Escape is pressed", () => {
    mocks.sessions = [sessionToday("s1", "Old name")];
    render(<AppSidebar />);
    fireEvent.click(screen.getByTitle("Rename chat"));
    const input = screen.getByLabelText("Rename chat") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Renamed" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(mocks.renameSession).not.toHaveBeenCalled();
    // Editing ended, so the input is gone.
    expect(screen.queryByLabelText("Rename chat")).toBeNull();
  });

  it("does not rename when the draft is blank or unchanged", () => {
    mocks.sessions = [sessionToday("s1", "Same")];
    render(<AppSidebar />);
    fireEvent.click(screen.getByTitle("Rename chat"));
    // Unchanged draft (no edit before commit).
    fireEvent.mouseDown(screen.getByLabelText("Save name"));
    expect(mocks.renameSession).not.toHaveBeenCalled();
    // Blank draft.
    fireEvent.click(screen.getByTitle("Rename chat"));
    const input2 = screen.getByLabelText("Rename chat") as HTMLInputElement;
    fireEvent.change(input2, { target: { value: "   " } });
    fireEvent.mouseDown(screen.getByLabelText("Save name"));
    expect(mocks.renameSession).not.toHaveBeenCalled();
  });

  it("asks for confirmation and deletes the session on confirm", () => {
    mocks.sessions = [sessionToday("s1", "Bye")];
    render(<AppSidebar />);
    fireEvent.click(screen.getByTitle("Delete chat"));
    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(mocks.removeSession).toHaveBeenCalledWith("s1");
  });

  it("does not delete when the confirm dialog is cancelled", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    mocks.sessions = [sessionToday("s1", "Bye")];
    render(<AppSidebar />);
    fireEvent.click(screen.getByTitle("Delete chat"));
    expect(mocks.removeSession).not.toHaveBeenCalled();
  });

  it("blocks deleting the actively-streaming chat (busy guard)", () => {
    mocks.busy = true;
    mocks.pathname = "/chat/s1";
    mocks.sessions = [sessionToday("s1", "Streaming")];
    render(<AppSidebar />);
    const deleteButton = screen.getByTitle("Delete chat");
    expect(deleteButton.hasAttribute("disabled")).toBe(true);
    fireEvent.click(deleteButton);
    expect(mocks.removeSession).not.toHaveBeenCalled();
  });

  it("deletes a non-active chat even while another chat is streaming", () => {
    mocks.busy = true;
    mocks.pathname = "/chat/s1";
    mocks.sessions = [sessionToday("s1", "Streaming"), sessionToday("s2", "Idle")];
    render(<AppSidebar />);
    const deleteButtons = screen.getAllByTitle("Delete chat");
    // Find the one for s2 (the idle chat) — it should not be disabled.
    const idleDelete = deleteButtons.find((btn) => !btn.hasAttribute("disabled"));
    expect(idleDelete).toBeTruthy();
    fireEvent.click(idleDelete as HTMLElement);
    expect(mocks.removeSession).toHaveBeenCalledWith("s2");
  });

  it("navigates back to '/' (replace) when deleting the active chat", () => {
    mocks.pathname = "/chat/s1";
    mocks.sessions = [sessionToday("s1", "Active")];
    render(<AppSidebar />);
    fireEvent.click(screen.getByTitle("Delete chat"));
    expect(mocks.removeSession).toHaveBeenCalledWith("s1");
    expect(mocks.navigate).toHaveBeenCalledWith({ to: "/", replace: true });
  });
});

describe("AppSidebar mobile + footer", () => {
  it("renders the mobile backdrop when expanded", () => {
    mocks.sidebarOpen = true;
    render(<AppSidebar />);
    expect(screen.getByRole("button", { name: "Close sidebar" })).toBeTruthy();
  });

  it("does not render the mobile backdrop when collapsed", () => {
    mocks.sidebarOpen = false;
    render(<AppSidebar />);
    expect(screen.queryByRole("button", { name: "Close sidebar" })).toBeNull();
  });

  it("closes the sidebar when the mobile backdrop is tapped", () => {
    mocks.sidebarOpen = true;
    render(<AppSidebar />);
    fireEvent.click(screen.getByRole("button", { name: "Close sidebar" }));
    expect(mocks.closeSidebar).toHaveBeenCalledTimes(1);
  });

  it("renders the theme toggle footer, passing the expanded flag", () => {
    render(<AppSidebar />);
    const toggle = screen.getByTestId("theme-toggle");
    expect(toggle.getAttribute("data-with-label")).toBe("true");
  });

  it("passes withLabel=false to the theme toggle when collapsed (rail)", () => {
    mocks.sidebarOpen = false;
    render(<AppSidebar />);
    expect(screen.getByTestId("theme-toggle").getAttribute("data-with-label")).toBe("false");
  });
});
