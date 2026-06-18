import { AlertCircle, Plus, Trash2, X } from "lucide-react";
import { type ReactNode, useId, useState } from "react";

import { Button } from "~/components/ui/button";
import { Markdown } from "~/components/ui/markdown";
import {
  type DraftErrors,
  hasDraftErrors,
  type ReferenceDraft,
  type SkillDraft,
  validateDraft,
} from "~/lib/skills/skill-draft";
import {
  countLines,
  DESCRIPTION_MAX,
  NAME_MAX,
  SKILL_BODY_MAX_CHARS,
  SKILL_BODY_MAX_LINES,
} from "~/lib/skills/validation";

/**
 * Wire shape the editor builds from its draft on submit. References carry an
 * optional id (present when editing an existing reference, omitted for new
 * ones) so the store's replace-set semantics can keep-by-id / create-new /
 * drop-missing.
 */
export type CreateSkillPayload = {
  name: string;
  description: string;
  body: string;
  references: { id?: string; name: string; description: string; body: string }[];
};

/**
 * Create/edit form for a Skill. Owns the draft state, runs validateDraft on
 * submit, and surfaces per-field errors. Extracted from src/routes/skills.tsx
 * so the editor's submit + error + references management contract is
 * unit-testable in isolation, mirroring the chat-message extraction pattern.
 * Zero behavior change.
 */
export function SkillEditor({
  initialDraft,
  nextReferenceKey,
  onCancel,
  onSaved,
  onSubmit,
}: {
  initialDraft: SkillDraft;
  /** Mints a stable key for each newly-added reference React list row. */
  nextReferenceKey: () => string;
  onCancel: () => void;
  onSaved: (saved: { id: string }) => void;
  onSubmit: (draft: CreateSkillPayload) => { id: string } | null;
}) {
  const [draft, setDraft] = useState(initialDraft);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<DraftErrors>({ references: {} });
  const [showPreview, setShowPreview] = useState(false);
  const isEditing = Boolean(initialDraft.name);

  function updateReference(key: string, patch: Partial<ReferenceDraft>) {
    setDraft((current) => ({
      ...current,
      references: current.references.map((reference) =>
        reference.key === key ? { ...reference, ...patch } : reference,
      ),
    }));
    setFieldErrors((current) => {
      const { [key]: _cleared, ...rest } = current.references;
      return _cleared ? { ...current, references: rest } : current;
    });
  }

  function updateDraftField(field: "name" | "description" | "body", value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
  }

  async function handleSubmit() {
    if (isSaving) {
      return;
    }

    const errors = validateDraft(draft);

    if (hasDraftErrors(errors)) {
      setFieldErrors(errors);
      return;
    }

    setIsSaving(true);
    setSaveError(null);

    try {
      const payload: CreateSkillPayload = {
        name: draft.name.trim(),
        description: draft.description.trim(),
        body: draft.body.trim(),
        references: draft.references.map((reference) => ({
          ...(reference.id ? { id: reference.id } : {}),
          name: reference.name.trim(),
          description: reference.description.trim(),
          body: reference.body.trim(),
        })),
      };

      const saved = onSubmit(payload);
      if (!saved) {
        setSaveError("This skill could not be found. It may have been deleted.");
        return;
      }
      onSaved(saved);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Failed to save the skill.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form
      className="rounded-lg border border-border bg-card px-4 py-4 sm:px-6 sm:py-5"
      onSubmit={(event) => {
        event.preventDefault();
        void handleSubmit();
      }}
    >
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-sm font-semibold text-foreground">
          {isEditing ? `Edit '${initialDraft.name}'` : "New skill"}
        </h2>
        <Button
          aria-label="Close editor"
          onClick={onCancel}
          size="icon"
          type="button"
          variant="ghost"
        >
          <X aria-hidden="true" className="size-4" />
        </Button>
      </div>

      <div className="mt-4 space-y-5">
        <div className="grid gap-5 sm:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
          <Field
            counter={`${draft.name.length}/${NAME_MAX}`}
            error={fieldErrors.name}
            hint="Lowercase letters, digits, and single hyphens."
            label="Name"
          >
            {(id) => (
              <input
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/30"
                id={id}
                maxLength={NAME_MAX}
                onChange={(event) => updateDraftField("name", event.currentTarget.value)}
                placeholder="my-skill"
                value={draft.name}
              />
            )}
          </Field>

          <Field
            counter={`${draft.description.length}/${DESCRIPTION_MAX}`}
            error={fieldErrors.description}
            hint="Tells the agent when to use this skill. Loaded into context at session start."
            label="Description"
          >
            {(id) => (
              <textarea
                className="min-h-[4.25rem] w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/30"
                id={id}
                maxLength={DESCRIPTION_MAX}
                onChange={(event) => updateDraftField("description", event.currentTarget.value)}
                placeholder="Use this skill when..."
                value={draft.description}
              />
            )}
          </Field>
        </div>

        <Field
          counter={`${countLines(draft.body)}/${SKILL_BODY_MAX_LINES} lines · ${draft.body.length}/${SKILL_BODY_MAX_CHARS.toLocaleString()} chars`}
          error={fieldErrors.body}
          hint="Markdown instructions loaded when the skill is activated (the SKILL.md body)."
          label="Instructions"
        >
          {(id) => (
            <div>
              <div className="mb-1.5 flex items-center gap-1">
                <Button
                  aria-pressed={!showPreview}
                  onClick={() => setShowPreview(false)}
                  size="sm"
                  type="button"
                  variant={showPreview ? "ghost" : "outline"}
                >
                  Write
                </Button>
                <Button
                  aria-pressed={showPreview}
                  onClick={() => setShowPreview(true)}
                  size="sm"
                  type="button"
                  variant={showPreview ? "outline" : "ghost"}
                >
                  Preview
                </Button>
              </div>
              {showPreview ? (
                <div className="min-h-48 rounded-md border border-input bg-background px-3 py-2">
                  {draft.body.trim() ? (
                    <div className="text-sm leading-6 text-foreground">
                      <Markdown>{draft.body}</Markdown>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Nothing to preview yet.</p>
                  )}
                </div>
              ) : (
                <textarea
                  className="min-h-48 w-full resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-xs leading-5 text-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/30"
                  id={id}
                  maxLength={SKILL_BODY_MAX_CHARS}
                  onChange={(event) => updateDraftField("body", event.currentTarget.value)}
                  placeholder={"# My skill\n\n## When to use\n..."}
                  value={draft.body}
                />
              )}
            </div>
          )}
        </Field>

        <div className="border-t border-border/70 pt-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold text-foreground">References</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Supporting documents the agent loads only when the instructions point to them.
              </p>
            </div>
            <Button
              onClick={() =>
                setDraft((current) => ({
                  ...current,
                  references: [
                    ...current.references,
                    { body: "", description: "", key: nextReferenceKey(), name: "" },
                  ],
                }))
              }
              size="sm"
              type="button"
              variant="outline"
            >
              <Plus aria-hidden="true" className="size-3.5" />
              Add reference
            </Button>
          </div>

          {draft.references.map((reference, index) => (
            <div className="mt-3 rounded-md border border-border/80 px-3 py-3" key={reference.key}>
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-semibold text-foreground">Reference {index + 1}</p>
                <Button
                  aria-label={`Remove reference ${index + 1}`}
                  onClick={() =>
                    setDraft((current) => ({
                      ...current,
                      references: current.references.filter((item) => item.key !== reference.key),
                    }))
                  }
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  <Trash2 aria-hidden="true" className="size-3.5" />
                </Button>
              </div>

              <div className="mt-2 space-y-3">
                <div className="grid gap-3 sm:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
                  <Field
                    counter={`${reference.name.length}/${NAME_MAX}`}
                    error={fieldErrors.references[reference.key]?.name}
                    label="Name"
                  >
                    {(id) => (
                      <input
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/30"
                        id={id}
                        maxLength={NAME_MAX}
                        onChange={(event) =>
                          updateReference(reference.key, { name: event.currentTarget.value })
                        }
                        placeholder="api-reference"
                        value={reference.name}
                      />
                    )}
                  </Field>
                  <Field
                    counter={`${reference.description.length}/${DESCRIPTION_MAX}`}
                    error={fieldErrors.references[reference.key]?.description}
                    label="Description"
                  >
                    {(id) => (
                      <input
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/30"
                        id={id}
                        maxLength={DESCRIPTION_MAX}
                        onChange={(event) =>
                          updateReference(reference.key, {
                            description: event.currentTarget.value,
                          })
                        }
                        placeholder="What this document covers"
                        value={reference.description}
                      />
                    )}
                  </Field>
                </div>
                <Field error={fieldErrors.references[reference.key]?.body} label="Content">
                  {(id) => (
                    <textarea
                      className="min-h-24 w-full resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-xs leading-5 text-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/30"
                      id={id}
                      onChange={(event) =>
                        updateReference(reference.key, { body: event.currentTarget.value })
                      }
                      placeholder="Markdown content..."
                      value={reference.body}
                    />
                  )}
                </Field>
              </div>
            </div>
          ))}
        </div>
      </div>

      {saveError ? (
        <div
          className="mt-4 flex items-start gap-2 rounded-md border border-destructive/30 px-3 py-2 text-xs text-destructive"
          role="alert"
        >
          <AlertCircle aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          <p className="min-w-0 break-words">{saveError}</p>
        </div>
      ) : null}

      <div className="mt-5 flex items-center justify-end gap-2">
        <Button onClick={onCancel} size="sm" type="button" variant="ghost">
          Cancel
        </Button>
        <Button disabled={isSaving} size="sm" type="submit">
          {isSaving ? "Saving..." : isEditing ? "Save changes" : "Create skill"}
        </Button>
      </div>
    </form>
  );
}

/**
 * Labeled form field wrapper with an optional counter, hint, and error line.
 * Uses a render-prop pattern so the caller controls the exact input element
 * while the field owns the label/input id linkage via useId.
 */
export function Field({
  children,
  counter,
  error,
  hint,
  label,
}: {
  children: (id: string) => ReactNode;
  counter?: string;
  error?: string;
  hint?: string;
  label: string;
}) {
  const id = useId();

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label className="text-xs font-medium text-foreground" htmlFor={id}>
          {label}
        </label>
        {counter ? (
          <span className="tabular-nums text-[11px] text-muted-foreground">{counter}</span>
        ) : null}
      </div>
      {hint ? <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p> : null}
      <div className="mt-1.5">{children(id)}</div>
      {error ? (
        <p className="mt-1 text-[11px] font-medium text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
