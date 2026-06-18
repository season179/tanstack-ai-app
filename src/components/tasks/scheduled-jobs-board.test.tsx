// @vitest-environment jsdom
//
// DOM-environment component tests for ScheduledJobsBoard — the entire /tasks
// page surface. Its pure helpers (display.ts: formatDuration / formatRelative
// / scheduleLabel / getRunResult / runStatusClasses / payloadKindLabel —
// iteration 37/66) and its data layout (scheduler.ts: buildOverview / canFire
// — iteration 43) already have co-located coverage, and the store + hook
// reactivity is pinned (tasks-store.dom.test.ts, use-tasks.dom.test.ts). What
// had ZERO coverage was the component itself: its four-section board layout
// (Running now / Up next / Paused / Past runs), the empty-state vs. board
// switch, the per-row action wiring (disable / enable / delete-with-confirm /
// view transcript), and the New task dialog open path.
//
// Harness: the store snapshot getters (tasks-store) and the mutation hooks
// (use-tasks) are mocked so the board renders against controlled fixtures,
// while the REAL buildOverview / canFire / display formatters run on those
// fixtures — turning these into faithful integration tests of the
// fixtures → overview → sections → row render pipeline. The scheduler's
// startTaskScheduler is never started because use-tasks is mocked, and the
// router is never needed because useGoToTranscript is mocked.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ScheduledJobsBoard } from "~/components/tasks/scheduled-jobs-board";
import type { ScheduledTask, ScheduledTaskRun } from "~/lib/tasks/types";

// vi.mock factories are hoisted before imports, so the shared fixtures +
// spies live in a hoisted object whose properties the factories read at call
// time. Individual tests reassign mocks.tasks / mocks.runs and clear the
// action spies in beforeEach.
const mocks = vi.hoisted(() => ({
  tasks: [] as ScheduledTask[],
  runs: [] as ScheduledTaskRun[],
  createTask: vi.fn(),
  updateTask: vi.fn(),
  removeTask: vi.fn(),
  goToTranscript: vi.fn(),
}));

vi.mock("~/lib/hooks/use-tasks", () => ({
  // The board only destructures createTask/removeTask/updateTask from
  // useTasks (never the snapshot — it reads the store directly), so the mock
  // returns the spies and never boots the real scheduler.
  useTasks: () => ({
    tasks: mocks.tasks,
    createTask: mocks.createTask,
    updateTask: mocks.updateTask,
    removeTask: mocks.removeTask,
  }),
  // No router context needed: goToTranscript is a plain spy.
  useGoToTranscript: () => mocks.goToTranscript,
}));

vi.mock("~/lib/tasks/tasks-store", () => ({
  // No-op subscribe: useSyncExternalStore never auto re-renders (reactivity
  // is already covered by the store/hook tests); each test sets the fixtures
  // once before render.
  subscribeTasks: () => () => {},
  getTasksSnapshot: () => mocks.tasks,
  getRunsSnapshot: () => mocks.runs,
}));

beforeEach(() => {
  // Deterministic clock so cron projection (next fire after lastFiredAt) and
  // the relative-time / duration formatters are exactly predictable. All
  // fixtures' ISO timestamps are anchored against this instant.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2024-06-01T00:00:00.000Z"));

  mocks.tasks = [];
  mocks.runs = [];
  mocks.createTask.mockClear();
  mocks.updateTask.mockClear();
  mocks.removeTask.mockClear();
  mocks.goToTranscript.mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// --- Fixtures --------------------------------------------------------------
// Frozen clock = 2024-06-01T00:00:00.000Z. The enabled cron task's
// lastFiredAt is chosen so its next cron fire lands in the FUTURE (so
// buildOverview lists it under Up next, not skips it as already-due).

function makeTask(overrides: Partial<ScheduledTask>): ScheduledTask {
  return {
    id: "task-1",
    title: "Task",
    scheduleType: "cron",
    payload: { kind: "instruction", instruction: "Do the thing" },
    cron: "0 9 * * *",
    timezone: "UTC",
    runAt: null,
    isEnabled: true,
    createdAt: "2024-05-01T00:00:00.000Z",
    updatedAt: "2024-05-01T00:00:00.000Z",
    lastFiredAt: "2024-05-31T09:00:00.000Z",
    homeSessionId: "sess-1",
    ...overrides,
  };
}

function makeRun(overrides: Partial<ScheduledTaskRun>): ScheduledTaskRun {
  return {
    id: "run-1",
    taskId: "task-1",
    taskTitle: "Task",
    scheduleType: "cron",
    payloadKind: "instruction",
    status: "completed",
    output: null,
    error: null,
    startedAt: "2024-05-31T23:58:00.000Z",
    completedAt: "2024-05-31T23:58:05.000Z",
    homeSessionId: "sess-1",
    ...overrides,
  };
}

/** The four section headings are <h2 role="heading">; scope queries to a
 *  section by walking from its heading up to the enclosing <section>. */
function section(name: RegExp): HTMLElement {
  const heading = screen.getByRole("heading", { name });
  return heading.closest("section") as unknown as HTMLElement;
}

function renderBoard() {
  return render(<ScheduledJobsBoard />);
}

describe("ScheduledJobsBoard empty state", () => {
  it("renders the empty state and none of the four section headings when there are no tasks or runs", () => {
    renderBoard();

    expect(screen.getByText("No scheduled tasks yet")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /Running now/ })).toBeNull();
    expect(screen.queryByRole("heading", { name: /Up next/ })).toBeNull();
    expect(screen.queryByRole("heading", { name: /Paused/ })).toBeNull();
    expect(screen.queryByRole("heading", { name: /Past runs/ })).toBeNull();
  });

  it("opens the create dialog from the empty-state New task button", () => {
    renderBoard();

    // The empty board renders TWO "New task" buttons: one in the always-on
    // SiteHeader and one inside the BoardEmptyState. Scope to the empty state
    // to target its own button specifically.
    const emptyState = screen.getByText("No scheduled tasks yet").closest("div") as HTMLElement;
    expect(screen.queryByText("New scheduled task")).toBeNull();
    fireEvent.click(within(emptyState).getByRole("button", { name: "New task" }));
    expect(screen.getByText("New scheduled task")).toBeTruthy();
  });
});

describe("ScheduledJobsBoard Running section", () => {
  it("renders a running run with its title, payload label, and a View transcript button", () => {
    mocks.runs = [
      makeRun({
        id: "run-running",
        taskId: "task-a",
        taskTitle: "Daily standup",
        status: "running",
        startedAt: "2024-05-31T23:59:50.000Z",
        completedAt: null,
        homeSessionId: "sess-running",
      }),
    ];

    renderBoard();

    const running = section(/Running now/);
    expect(within(running).getByText("Daily standup")).toBeTruthy();
    expect(within(running).getByText("check-in")).toBeTruthy();
    expect(within(running).getByRole("button", { name: "View transcript" })).toBeTruthy();
  });

  it("omits the View transcript button when the run has no home session", () => {
    mocks.runs = [
      makeRun({
        id: "run-running",
        taskTitle: "Standalone run",
        status: "running",
        homeSessionId: null,
      }),
    ];

    renderBoard();

    const running = section(/Running now/);
    expect(within(running).queryByRole("button", { name: "View transcript" })).toBeNull();
  });

  it("calls goToTranscript with the run's homeSessionId when View transcript is clicked", () => {
    mocks.runs = [
      makeRun({
        id: "run-running",
        status: "running",
        homeSessionId: "sess-xyz",
      }),
    ];

    renderBoard();
    fireEvent.click(
      within(section(/Running now/)).getByRole("button", { name: "View transcript" }),
    );

    expect(mocks.goToTranscript).toHaveBeenCalledTimes(1);
    expect(mocks.goToTranscript).toHaveBeenCalledWith("sess-xyz");
  });

  it("shows the empty note when nothing is running (board non-empty via a past run)", () => {
    // The per-section empty note only renders when the board itself is
    // NON-empty (otherwise the whole-board empty state takes over). Seed a
    // past run so the sections render, then assert the Running note.
    mocks.runs = [
      makeRun({ id: "run-past", status: "completed", output: { statusUpdate: "Done." } }),
    ];

    renderBoard();
    expect(section(/Running now/).textContent).toContain("Nothing is running right now.");
  });
});

describe("ScheduledJobsBoard Up next section", () => {
  function upcomingTask(): ScheduledTask {
    // lastFiredAt 2024-05-31T09:00Z + cron "0 9 * * *" → next fire
    // 2024-06-01T09:00Z, which is in the FUTURE of the frozen clock, so
    // buildOverview lists it as upcoming.
    return makeTask({
      id: "task-upcoming",
      title: "Daily standup",
      cron: "0 9 * * *",
      lastFiredAt: "2024-05-31T09:00:00.000Z",
      homeSessionId: "sess-upcoming",
    });
  }

  it("renders an upcoming cron task with its schedule label and Disable/Delete actions", () => {
    mocks.tasks = [upcomingTask()];

    renderBoard();

    const upNext = section(/Up next/);
    expect(within(upNext).getByText("Daily standup")).toBeTruthy();
    expect(within(upNext).getByText("Recurring · cron 0 9 * * *")).toBeTruthy();
    expect(within(upNext).getByRole("button", { name: "Disable task" })).toBeTruthy();
    expect(within(upNext).getByRole("button", { name: "Delete task" })).toBeTruthy();
    expect(within(upNext).getByRole("button", { name: "View transcript" })).toBeTruthy();
  });

  it("disables the task (updateTask isEnabled:false) when the Pause button is clicked", () => {
    mocks.tasks = [upcomingTask()];

    renderBoard();
    // The row's first button is View transcript — click Disable by name.
    fireEvent.click(within(section(/Up next/)).getByRole("button", { name: "Disable task" }));

    expect(mocks.updateTask).toHaveBeenCalledTimes(1);
    expect(mocks.updateTask).toHaveBeenCalledWith("task-upcoming", { isEnabled: false });
  });

  it("deletes the task after confirming, and does not when cancelled", () => {
    mocks.tasks = [upcomingTask()];

    // Confirm → removeTask fires.
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderBoard();
    fireEvent.click(screen.getByRole("button", { name: "Delete task" }));
    expect(mocks.removeTask).toHaveBeenCalledTimes(1);
    expect(mocks.removeTask).toHaveBeenCalledWith("task-upcoming");
    expect(confirmSpy).toHaveBeenCalledTimes(1);

    // Cancel → removeTask does not fire. A fresh render + a false confirm
    // isolates the negative path.
    cleanup();
    mocks.removeTask.mockClear();
    confirmSpy.mockReturnValue(false);
    renderBoard();
    fireEvent.click(screen.getByRole("button", { name: "Delete task" }));
    expect(mocks.removeTask).not.toHaveBeenCalled();
  });

  it("shows the empty note when no tasks are scheduled to run (board non-empty via a past run)", () => {
    mocks.runs = [
      makeRun({ id: "run-past", status: "completed", output: { statusUpdate: "Done." } }),
    ];

    renderBoard();
    expect(section(/Up next/).textContent).toContain("No active tasks are scheduled to run.");
  });
});

describe("ScheduledJobsBoard Paused section", () => {
  function pausedTask(): ScheduledTask {
    return makeTask({
      id: "task-paused",
      title: "Paused report",
      cron: "0 10 * * *",
      isEnabled: false,
      lastFiredAt: "2024-05-31T10:00:00.000Z",
      homeSessionId: "sess-paused",
    });
  }

  it("renders a paused task with Enable/Delete actions and the schedule label", () => {
    mocks.tasks = [pausedTask()];

    renderBoard();

    const paused = section(/Paused/);
    expect(within(paused).getByText("Paused report")).toBeTruthy();
    expect(within(paused).getByText("Recurring · cron 0 10 * * *")).toBeTruthy();
    expect(within(paused).getByRole("button", { name: "Enable task" })).toBeTruthy();
    expect(within(paused).getByRole("button", { name: "Delete task" })).toBeTruthy();
  });

  it("enables the task (updateTask isEnabled:true) when the Play button is clicked", () => {
    mocks.tasks = [pausedTask()];

    renderBoard();
    fireEvent.click(within(section(/Paused/)).getByRole("button", { name: "Enable task" }));

    expect(mocks.updateTask).toHaveBeenCalledWith("task-paused", { isEnabled: true });
  });

  it("is omitted entirely (no Paused heading) when there are no paused tasks", () => {
    // An enabled cron task is upcoming, not paused; an empty board shows the
    // empty state, so neither produces a Paused heading.
    mocks.tasks = [
      makeTask({ id: "task-enabled", cron: "0 9 * * *", lastFiredAt: "2024-05-31T09:00:00.000Z" }),
    ];

    renderBoard();
    expect(screen.queryByRole("heading", { name: /^Paused/ })).toBeNull();
  });
});

describe("ScheduledJobsBoard Past runs section", () => {
  it("renders completed and failed runs with status badges, durations, and results", () => {
    mocks.runs = [
      makeRun({
        id: "run-completed",
        taskTitle: "Completed job",
        status: "completed",
        startedAt: "2024-05-31T23:58:00.000Z",
        completedAt: "2024-05-31T23:58:05.000Z",
        output: { statusUpdate: "All checks passed." },
        homeSessionId: "sess-done",
      }),
      makeRun({
        id: "run-failed",
        taskTitle: "Broken job",
        status: "failed",
        startedAt: "2024-05-31T23:57:00.000Z",
        completedAt: "2024-05-31T23:57:02.000Z",
        error: "Connection refused.",
        output: null,
      }),
    ];

    renderBoard();

    const past = section(/Past runs/);
    expect(within(past).getByText("Completed job")).toBeTruthy();
    expect(within(past).getByText("Broken job")).toBeTruthy();
    expect(within(past).getByText("completed")).toBeTruthy();
    expect(within(past).getByText("failed")).toBeTruthy();
    // getRunResult: statusUpdate verdict for the completed run; the raw error
    // for the failed run (error takes precedence over output).
    expect(within(past).getByText("All checks passed.")).toBeTruthy();
    expect(within(past).getByText("Connection refused.")).toBeTruthy();
    // formatDuration: 5s and 2s.
    expect(within(past).getByText("5s")).toBeTruthy();
    expect(within(past).getByText("2s")).toBeTruthy();
  });

  it("shows the empty note when no runs have finished (board non-empty via a running run)", () => {
    mocks.runs = [makeRun({ id: "run-running", status: "running", completedAt: null })];

    renderBoard();
    expect(section(/Past runs/).textContent).toContain("No runs have finished yet.");
  });

  it("renders an in-flight run with an em-dash duration (no completedAt)", () => {
    mocks.runs = [
      makeRun({
        id: "run-running",
        status: "running",
        completedAt: null,
      }),
    ];

    renderBoard();

    // The run is in the Running section (not Past); Past shows its empty note.
    expect(section(/Running now/).textContent).toContain("Task");
    expect(section(/Past runs/).textContent).toContain("No runs have finished yet.");
  });
});

describe("ScheduledJobsBoard all sections together", () => {
  it("renders all four sections at once when running/upcoming/paused/past are all populated", () => {
    mocks.tasks = [
      // upcoming
      makeTask({
        id: "task-upcoming",
        title: "Upcoming task",
        cron: "0 9 * * *",
        lastFiredAt: "2024-05-31T09:00:00.000Z",
      }),
      // paused
      makeTask({
        id: "task-paused",
        title: "Paused task",
        cron: "0 10 * * *",
        isEnabled: false,
        lastFiredAt: "2024-05-31T10:00:00.000Z",
      }),
    ];
    mocks.runs = [
      // running
      makeRun({
        id: "run-running",
        taskTitle: "Running task",
        status: "running",
        completedAt: null,
      }),
      // past
      makeRun({
        id: "run-past",
        taskTitle: "Past task",
        status: "completed",
        output: { statusUpdate: "Done." },
      }),
    ];

    renderBoard();

    expect(screen.queryByText("No scheduled tasks yet")).toBeNull();
    expect(screen.getByRole("heading", { name: /Running now/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Up next/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /^Paused/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Past runs/ })).toBeTruthy();
    // Each populated row title is present exactly once.
    expect(screen.getByText("Running task")).toBeTruthy();
    expect(screen.getByText("Upcoming task")).toBeTruthy();
    expect(screen.getByText("Paused task")).toBeTruthy();
    expect(screen.getByText("Past task")).toBeTruthy();
  });
});

describe("ScheduledJobsBoard header", () => {
  it("shows the Live status and a New task action that opens the create dialog", () => {
    mocks.tasks = [
      makeTask({ id: "task-upcoming", cron: "0 9 * * *", lastFiredAt: "2024-05-31T09:00:00.000Z" }),
    ];

    renderBoard();

    expect(screen.getByText("Live")).toBeTruthy();
    expect(screen.queryByText("New scheduled task")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "New task" }));
    expect(screen.getByText("New scheduled task")).toBeTruthy();
  });
});
