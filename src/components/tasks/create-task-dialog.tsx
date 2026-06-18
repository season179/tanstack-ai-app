import { X } from "lucide-react";
import { useEffect, useId, useState } from "react";

import { Button } from "~/components/ui/button";
import {
  type Draft,
  EMPTY_DRAFT,
  type Errors,
  INSTRUCTION_MAX,
  localInputToIso,
  TITLE_MAX,
  toLocalInputValue,
  validate,
} from "~/lib/tasks/create-task-helpers";
import type { CreateScheduledTaskInput } from "~/lib/tasks/types";
import { cn } from "~/lib/utils";

const CRON_PRESETS: { label: string; value: string }[] = [
  { label: "Every minute", value: "* * * * *" },
  { label: "Every 5 minutes", value: "*/5 * * * *" },
  { label: "Hourly", value: "0 * * * *" },
  { label: "Daily at 09:00", value: "0 9 * * *" },
];

const QUICK_OFFSETS: { label: string; seconds: number }[] = [
  { label: "+10s", seconds: 10 },
  { label: "+30s", seconds: 30 },
  { label: "+1m", seconds: 60 },
  { label: "+5m", seconds: 300 },
];

export function CreateTaskDialog({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (input: CreateScheduledTaskInput) => void;
}) {
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [errors, setErrors] = useState<Errors>({});
  // titleId names the <h2> that the dialog exposes via aria-labelledby; the
  // Title input needs its OWN id so its <label htmlFor> resolves unambiguously
  // (reusing titleId for both made the label association ambiguous — an a11y
  // bug where the label matched both the heading and the input).
  const titleId = useId();
  const titleInputId = useId();
  const instructionId = useId();

  // Reset the form each time the dialog opens, and prefill the one-off time to
  // "10 minutes from now" so the field isn't empty by default.
  useEffect(() => {
    if (open) {
      const soon = new Date(Date.now() + 10 * 60 * 1000);
      setDraft({ ...EMPTY_DRAFT, runAtLocal: toLocalInputValue(soon) });
      setErrors({});
    }
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  function handleSubmit() {
    const found = validate(draft);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      return;
    }

    const input: CreateScheduledTaskInput = {
      title: draft.title.trim(),
      instruction: draft.instruction.trim(),
      scheduleType: draft.scheduleType,
      ...(draft.scheduleType === "once"
        ? { runAt: localInputToIso(draft.runAtLocal), cron: null }
        : { cron: draft.cron.trim(), runAt: null }),
    };
    onCreate(input);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto px-4 py-10">
      {/* Visual backdrop only — no handlers (avoids a11y static-element warning). */}
      <div aria-hidden="true" className="fixed inset-0 bg-foreground/30 backdrop-blur-[1px]" />
      {/* Full-screen click catcher behind the panel closes on click. */}
      <button
        aria-label="Close dialog"
        className="fixed inset-0 cursor-default outline-none"
        onClick={onClose}
        type="button"
      />
      <div
        className="relative w-full max-w-lg rounded-lg border border-border bg-card shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <h2 id={titleId} className="text-sm font-semibold text-foreground">
            New scheduled task
          </h2>
          <Button
            aria-label="Close dialog"
            onClick={onClose}
            size="icon"
            type="button"
            variant="ghost"
          >
            <X aria-hidden="true" className="size-4" />
          </Button>
        </div>

        <form
          className="space-y-5 px-5 py-5"
          onSubmit={(event) => {
            event.preventDefault();
            handleSubmit();
          }}
        >
          <div>
            <label className="text-xs font-medium text-foreground" htmlFor={titleInputId}>
              Title
            </label>
            <input
              aria-invalid={Boolean(errors.title)}
              className={cn(
                "mt-1.5 w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/30",
                errors.title ? "border-destructive" : "border-input",
              )}
              id={titleInputId}
              maxLength={TITLE_MAX}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setDraft((d) => ({ ...d, title: value }));
              }}
              placeholder="Daily standup check-in"
              value={draft.title}
            />
            {errors.title ? (
              <p className="mt-1 text-[11px] font-medium text-destructive" role="alert">
                {errors.title}
              </p>
            ) : null}
          </div>

          <div>
            <span className="text-xs font-medium text-foreground">Schedule</span>
            <div className="mt-1.5 flex gap-1.5">
              {(["once", "cron"] as const).map((kind) => (
                <Button
                  aria-pressed={draft.scheduleType === kind}
                  key={kind}
                  onClick={() => setDraft((d) => ({ ...d, scheduleType: kind }))}
                  size="sm"
                  type="button"
                  variant={draft.scheduleType === kind ? "outline" : "ghost"}
                >
                  {kind === "once" ? "One-off" : "Recurring (cron)"}
                </Button>
              ))}
            </div>

            {draft.scheduleType === "once" ? (
              <div className="mt-3">
                <label className="text-[11px] text-muted-foreground" htmlFor={`${titleId}-runat`}>
                  Fire once at
                </label>
                <input
                  aria-invalid={Boolean(errors.runAt)}
                  className={cn(
                    "mt-1 block w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/30",
                    errors.runAt ? "border-destructive" : "border-input",
                  )}
                  id={`${titleId}-runat`}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setDraft((d) => ({ ...d, runAtLocal: value }));
                  }}
                  step={1}
                  type="datetime-local"
                  value={draft.runAtLocal}
                />
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {QUICK_OFFSETS.map((offset) => (
                    <Button
                      key={offset.label}
                      onClick={() =>
                        setDraft((d) => ({
                          ...d,
                          runAtLocal: toLocalInputValue(
                            new Date(Date.now() + offset.seconds * 1000),
                          ),
                        }))
                      }
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      {offset.label}
                    </Button>
                  ))}
                </div>
                {errors.runAt ? (
                  <p className="mt-1 text-[11px] font-medium text-destructive" role="alert">
                    {errors.runAt}
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="mt-3">
                <label className="text-[11px] text-muted-foreground" htmlFor={`${titleId}-cron`}>
                  Cron expression (5-field, UTC)
                </label>
                <input
                  aria-invalid={Boolean(errors.cron)}
                  className={cn(
                    "mt-1 block w-full rounded-md border bg-background px-3 py-2 font-mono text-xs text-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/30",
                    errors.cron ? "border-destructive" : "border-input",
                  )}
                  id={`${titleId}-cron`}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setDraft((d) => ({ ...d, cron: value }));
                  }}
                  placeholder="*/5 * * * *"
                  value={draft.cron}
                />
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {CRON_PRESETS.map((preset) => (
                    <Button
                      key={preset.value}
                      onClick={() => setDraft((d) => ({ ...d, cron: preset.value }))}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      {preset.label}
                    </Button>
                  ))}
                </div>
                {errors.cron ? (
                  <p className="mt-1 text-[11px] font-medium text-destructive" role="alert">
                    {errors.cron}
                  </p>
                ) : null}
              </div>
            )}
          </div>

          <div>
            <label className="text-xs font-medium text-foreground" htmlFor={instructionId}>
              Instruction
            </label>
            <textarea
              aria-invalid={Boolean(errors.instruction)}
              className={cn(
                "mt-1.5 min-h-24 w-full resize-y rounded-md border bg-background px-3 py-2 text-sm leading-6 text-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/30",
                errors.instruction ? "border-destructive" : "border-input",
              )}
              id={instructionId}
              maxLength={INSTRUCTION_MAX}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setDraft((d) => ({ ...d, instruction: value }));
              }}
              placeholder="Summarize yesterday's progress and today's plan."
              value={draft.instruction}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              When this task fires, the instruction runs against the chat model and the reply is
              written to the task's transcript.
            </p>
            {errors.instruction ? (
              <p className="mt-1 text-[11px] font-medium text-destructive" role="alert">
                {errors.instruction}
              </p>
            ) : null}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-border/70 pt-4">
            <Button onClick={onClose} size="sm" type="button" variant="ghost">
              Cancel
            </Button>
            <Button size="sm" type="submit">
              Create task
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
