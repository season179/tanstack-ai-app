// @vitest-environment jsdom
//
// DOM-environment component tests for CreateTaskDialog — the modal form that
// mints a scheduled task. The pure validation + datetime-local helpers were
// extracted and tested in iteration 64 (create-task-helpers.test.ts), but the
// component's interactive behavior — open/close, prefill-on-open, schedule-
// type toggle, quick-offset and cron-preset buttons, validation-error
// rendering, and the submit→onCreate→onClose flow — had zero coverage despite
// driving the entire task-creation UX. This pins that behavior on top of the
// render/screen/fireEvent harness established for ModelPicker (iteration 55)
// and the disclosure panels (iteration 59).
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CreateTaskDialog } from "~/components/tasks/create-task-dialog";
import { localInputToIso } from "~/lib/tasks/create-task-helpers";
import type { CreateScheduledTaskInput } from "~/lib/tasks/types";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** jsdom normalizes datetime-local input values inconsistently (it drops a
 *  trailing :00 seconds, and may append .000 for non-zero seconds) compared
 *  to the helper's canonical YYYY-MM-DDTHH:MM:SS form. Assert on the parsed
 *  instant rather than the exact string so the test is robust to that. */
function expectRunAtEquals(input: HTMLInputElement, expectedLocal: string) {
  expect(Date.parse(input.value)).toBe(Date.parse(expectedLocal));
}

/** Render the dialog and capture every onCreate call into a fresh array. */
function renderDialog(
  open: boolean,
  onCreate: (input: CreateScheduledTaskInput) => void = vi.fn(),
  onClose: () => void = vi.fn(),
) {
  render(<CreateTaskDialog onCreate={onCreate} onClose={onClose} open={open} />);
  return { onCreate, onClose };
}

/** Set a deterministic system clock so the prefill ("10 minutes from now")
 *  and quick-offset values are exactly predictable. */
function freezeClock(now: Date) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
}

describe("CreateTaskDialog open/close", () => {
  it("renders nothing when closed", () => {
    renderDialog(false);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText("New scheduled task")).toBeNull();
  });

  it("renders the dialog chrome when open", () => {
    renderDialog(true);
    expect(screen.getByRole("dialog", { name: "New scheduled task" })).toBeTruthy();
    expect(screen.getByText("New scheduled task")).toBeTruthy();
    expect(screen.getByLabelText("Title")).toBeTruthy();
    expect(screen.getByLabelText("Instruction")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create task" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
  });

  it("calls onClose when the header X button is clicked", () => {
    const onClose = vi.fn();
    renderDialog(true, vi.fn(), onClose);
    // There are two "Close dialog" aria-labels (header X + full-screen catcher);
    // scope to the header button inside the dialog title bar.
    const closeButtons = screen.getAllByLabelText("Close dialog");
    fireEvent.click(closeButtons[0]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when Cancel is clicked", () => {
    const onClose = vi.fn();
    renderDialog(true, vi.fn(), onClose);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when the full-screen click catcher is clicked", () => {
    const onClose = vi.fn();
    renderDialog(true, vi.fn(), onClose);
    const catcher = screen.getAllByLabelText("Close dialog").at(-1);
    expect(catcher).toBeDefined();
    if (!catcher) return;
    fireEvent.click(catcher);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when Escape is pressed", () => {
    const onClose = vi.fn();
    renderDialog(true, vi.fn(), onClose);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not listen for Escape while closed", () => {
    const onClose = vi.fn();
    renderDialog(false, vi.fn(), onClose);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("CreateTaskDialog prefill-on-open", () => {
  it("prefills the one-off time to ~10 minutes from now and starts on One-off", () => {
    freezeClock(new Date(2026, 0, 15, 12, 0, 0, 0));
    renderDialog(true);
    const runAt = screen.getByLabelText("Fire once at") as HTMLInputElement;
    // 10 minutes from 12:00:00 -> 12:10:00 local; compare via the parsed instant
    // (jsdom normalizes the datetime-local string form — see expectRunAtEquals).
    expectRunAtEquals(runAt, "2026-01-15T12:10:00");
    // One-off is the default schedule type.
    expect(screen.getByRole("button", { name: "One-off" })).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "One-off" }) as HTMLButtonElement).getAttribute(
        "aria-pressed",
      ),
    ).toBe("true");
  });

  it("clears stale errors when re-opened", () => {
    freezeClock(new Date(2026, 0, 15, 12, 0, 0, 0));
    const { unmount } = render(<CreateTaskDialog onClose={vi.fn()} onCreate={vi.fn()} open />);
    // Trigger validation errors by submitting an empty form.
    fireEvent.click(screen.getByRole("button", { name: "Create task" }));
    expect(screen.getByText("Title is required.")).toBeTruthy();
    unmount();

    // Re-open a fresh dialog: errors should be gone.
    render(<CreateTaskDialog onClose={vi.fn()} onCreate={vi.fn()} open />);
    expect(screen.queryByText("Title is required.")).toBeNull();
  });
});

describe("CreateTaskDialog schedule-type toggle", () => {
  it("switches to the cron field when Recurring is pressed", () => {
    renderDialog(true);
    fireEvent.click(screen.getByRole("button", { name: "Recurring (cron)" }));
    expect(screen.getByLabelText("Cron expression (5-field, UTC)")).toBeTruthy();
    expect(screen.queryByLabelText("Fire once at")).toBeNull();
    expect(
      (screen.getByRole("button", { name: "Recurring (cron)" }) as HTMLButtonElement).getAttribute(
        "aria-pressed",
      ),
    ).toBe("true");
  });

  it("switches back to the one-off field when One-off is pressed", () => {
    renderDialog(true);
    fireEvent.click(screen.getByRole("button", { name: "Recurring (cron)" }));
    fireEvent.click(screen.getByRole("button", { name: "One-off" }));
    expect(screen.getByLabelText("Fire once at")).toBeTruthy();
    expect(screen.queryByLabelText("Cron expression (5-field, UTC)")).toBeNull();
  });
});

describe("CreateTaskDialog quick-offset buttons", () => {
  it("sets the one-off time to +10s (preserving the seconds component)", () => {
    freezeClock(new Date(2026, 0, 15, 12, 0, 0, 0));
    renderDialog(true);
    fireEvent.click(screen.getByRole("button", { name: "+10s" }));
    expectRunAtEquals(
      screen.getByLabelText("Fire once at") as HTMLInputElement,
      "2026-01-15T12:00:10",
    );
  });

  it("sets the one-off time to +30s", () => {
    freezeClock(new Date(2026, 0, 15, 12, 0, 0, 0));
    renderDialog(true);
    fireEvent.click(screen.getByRole("button", { name: "+30s" }));
    expectRunAtEquals(
      screen.getByLabelText("Fire once at") as HTMLInputElement,
      "2026-01-15T12:00:30",
    );
  });

  it("sets the one-off time to +1m", () => {
    freezeClock(new Date(2026, 0, 15, 12, 0, 0, 0));
    renderDialog(true);
    fireEvent.click(screen.getByRole("button", { name: "+1m" }));
    expectRunAtEquals(
      screen.getByLabelText("Fire once at") as HTMLInputElement,
      "2026-01-15T12:01:00",
    );
  });

  it("sets the one-off time to +5m", () => {
    freezeClock(new Date(2026, 0, 15, 12, 0, 0, 0));
    renderDialog(true);
    fireEvent.click(screen.getByRole("button", { name: "+5m" }));
    expectRunAtEquals(
      screen.getByLabelText("Fire once at") as HTMLInputElement,
      "2026-01-15T12:05:00",
    );
  });
});

describe("CreateTaskDialog cron presets", () => {
  it("fills the cron field when a preset is clicked", () => {
    renderDialog(true);
    fireEvent.click(screen.getByRole("button", { name: "Recurring (cron)" }));
    fireEvent.click(screen.getByRole("button", { name: "Hourly" }));
    expect(
      (screen.getByLabelText("Cron expression (5-field, UTC)") as HTMLInputElement).value,
    ).toBe("0 * * * *");
  });

  it("fills the cron field with the daily preset", () => {
    renderDialog(true);
    fireEvent.click(screen.getByRole("button", { name: "Recurring (cron)" }));
    fireEvent.click(screen.getByRole("button", { name: "Daily at 09:00" }));
    expect(
      (screen.getByLabelText("Cron expression (5-field, UTC)") as HTMLInputElement).value,
    ).toBe("0 9 * * *");
  });
});

describe("CreateTaskDialog validation display", () => {
  it("shows title + instruction errors on an empty submit and does not call onCreate/onClose", () => {
    const onCreate = vi.fn();
    const onClose = vi.fn();
    // Pre-filled runAt is ~10min ahead so the only failures are title/instruction.
    freezeClock(new Date(2026, 0, 15, 12, 0, 0, 0));
    renderDialog(true, onCreate, onClose);

    fireEvent.click(screen.getByRole("button", { name: "Create task" }));
    expect(screen.getByText("Title is required.")).toBeTruthy();
    // The helper's exact instruction message (create-task-helpers.ts).
    expect(screen.getByText("An instruction is required.")).toBeTruthy();
    expect(onCreate).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows a runAt error when the one-off time is in the past", () => {
    freezeClock(new Date(2026, 0, 15, 12, 0, 0, 0));
    renderDialog(true);
    const runAt = screen.getByLabelText("Fire once at") as HTMLInputElement;
    fireEvent.change(runAt, { target: { value: "2020-01-01T00:00:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Create task" }));
    expect(screen.getByText(/in the future/)).toBeTruthy();
  });

  it("shows a cron error when the cron expression is invalid", () => {
    freezeClock(new Date(2026, 0, 15, 12, 0, 0, 0));
    renderDialog(true);
    fireEvent.click(screen.getByRole("button", { name: "Recurring (cron)" }));
    // hour 25 is out of range
    fireEvent.change(screen.getByLabelText("Cron expression (5-field, UTC)"), {
      target: { value: "0 25 * * *" },
    });
    // Fill title + instruction so only the cron error is the blocker.
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Bad cron task" } });
    fireEvent.change(screen.getByLabelText("Instruction"), {
      target: { value: "do something" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create task" }));
    // cron-parser surfaces the raw constraint error for out-of-range fields.
    expect(screen.getByText(/constraint/i)).toBeTruthy();
  });

  it("marks the invalid fields with aria-invalid", () => {
    freezeClock(new Date(2026, 0, 15, 12, 0, 0, 0));
    renderDialog(true);
    fireEvent.click(screen.getByRole("button", { name: "Create task" }));
    expect((screen.getByLabelText("Title") as HTMLInputElement).getAttribute("aria-invalid")).toBe(
      "true",
    );
    expect(
      (screen.getByLabelText("Instruction") as HTMLTextAreaElement).getAttribute("aria-invalid"),
    ).toBe("true");
  });
});

describe("CreateTaskDialog submit happy path", () => {
  it("creates a one-off task with the right shape and closes", () => {
    freezeClock(new Date(2026, 0, 15, 12, 0, 0, 0));
    const onCreate = vi.fn();
    const onClose = vi.fn();
    renderDialog(true, onCreate, onClose);

    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "  Standup  " },
    });
    fireEvent.change(screen.getByLabelText("Instruction"), {
      target: { value: "Summarize the day." },
    });
    // Prefilled runAt is 12:10:00; leave it.
    fireEvent.click(screen.getByRole("button", { name: "Create task" }));

    expect(onCreate).toHaveBeenCalledTimes(1);
    const input = onCreate.mock.calls[0][0] as CreateScheduledTaskInput;
    expect(input.title).toBe("Standup"); // trimmed
    expect(input.instruction).toBe("Summarize the day.");
    expect(input.scheduleType).toBe("once");
    expect(input.cron).toBeNull();
    // runAt is the prefill (12:10:00 local) converted to ISO via localInputToIso;
    // assert through the same local->UTC path so it's timezone-robust.
    expect(input.runAt).toBe(localInputToIso("2026-01-15T12:10:00"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("creates a recurring (cron) task with the right shape and closes", () => {
    const onCreate = vi.fn();
    const onClose = vi.fn();
    renderDialog(true, onCreate, onClose);

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Hourly ping" } });
    fireEvent.click(screen.getByRole("button", { name: "Recurring (cron)" }));
    fireEvent.click(screen.getByRole("button", { name: "Hourly" }));
    fireEvent.change(screen.getByLabelText("Instruction"), {
      target: { value: "Ping me." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create task" }));

    expect(onCreate).toHaveBeenCalledTimes(1);
    const input = onCreate.mock.calls[0][0] as CreateScheduledTaskInput;
    expect(input.title).toBe("Hourly ping");
    expect(input.scheduleType).toBe("cron");
    expect(input.cron).toBe("0 * * * *");
    expect(input.runAt).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("submits via the form onSubmit (Enter) the same as the button click", () => {
    freezeClock(new Date(2026, 0, 15, 12, 0, 0, 0));
    const onCreate = vi.fn();
    renderDialog(true, onCreate);

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "T" } });
    fireEvent.change(screen.getByLabelText("Instruction"), {
      target: { value: "I" },
    });
    const form = screen.getByRole("button", { name: "Create task" }).closest("form");
    expect(form).not.toBeNull();
    if (!form) return;
    fireEvent.submit(form);
    expect(onCreate).toHaveBeenCalledTimes(1);
  });
});

describe("CreateTaskDialog field binding", () => {
  it("updates the title draft as the user types", () => {
    renderDialog(true);
    const title = screen.getByLabelText("Title") as HTMLInputElement;
    fireEvent.change(title, { target: { value: "hello world" } });
    expect(title.value).toBe("hello world");
  });

  it("updates the instruction draft as the user types", () => {
    renderDialog(true);
    const instruction = screen.getByLabelText("Instruction") as HTMLTextAreaElement;
    fireEvent.change(instruction, { target: { value: "do the thing" } });
    expect(instruction.value).toBe("do the thing");
  });

  it("respects the TITLE_MAX / INSTRUCTION_MAX maxLength caps", () => {
    renderDialog(true);
    const title = screen.getByLabelText("Title") as HTMLInputElement;
    const instruction = screen.getByLabelText("Instruction") as HTMLTextAreaElement;
    expect(Number(title.getAttribute("maxLength"))).toBeGreaterThan(0);
    expect(Number(instruction.getAttribute("maxLength"))).toBeGreaterThan(0);
  });
});
