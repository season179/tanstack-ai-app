import { createFileRoute } from "@tanstack/react-router";
import { AlertCircle, BookOpen, Copy, FileText, Plus, Trash2, X } from "lucide-react";
import { useCallback, useId, useRef, useState } from "react";

import { SiteHeader, SiteHeaderStatus } from "~/components/site-header";
import { Button } from "~/components/ui/button";
import { Markdown } from "~/components/ui/markdown";
import { useHydrated } from "~/lib/hooks/use-hydrated";
import { type Skill, useSkills } from "~/lib/hooks/use-skills";
import {
  type DraftErrors,
  draftFromSkill,
  EMPTY_DRAFT,
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
import { cn } from "~/lib/utils";

export const Route = createFileRoute("/skills")({
  component: SkillsRoute,
});

let draftKeyCounter = 0;

function nextDraftKey() {
  draftKeyCounter += 1;
  return `draft-${draftKeyCounter}`;
}

function SkillsRoute() {
  const hydrated = useHydrated();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <h1 className="sr-only">Skills</h1>
      {hydrated ? <SkillsPageContent /> : <SiteHeader />}
    </div>
  );
}

function SkillsPageContent() {
  const { skills, createSkill, updateSkill, removeSkill } = useSkills();
  const [editorMode, setEditorMode] = useState<"closed" | "create" | "edit">("closed");
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);

  const selectedSkill = skills.find((skill) => skill.id === selectedId) ?? skills[0] ?? null;

  const closeEditor = useCallback(() => {
    setEditorMode("closed");
    setEditingSkill(null);
  }, []);

  const handleSaved = useCallback(
    (saved: Skill) => {
      closeEditor();
      setSelectedId(saved.id);
    },
    [closeEditor],
  );

  function openCreate() {
    setEditingSkill(null);
    setEditorMode("create");
    scrollDetailIntoViewOnSmallScreens(detailRef);
  }

  function selectSkill(id: string) {
    setSelectedId(id);
    closeEditor();
    scrollDetailIntoViewOnSmallScreens(detailRef);
  }

  function toggleEnabled(skill: Skill) {
    const updated = updateSkill(skill.id, { isEnabled: !skill.isEnabled });
    if (!updated) {
      setError(`Could not update '${skill.name}'.`);
    }
  }

  function removeSkillWithConfirm(skill: Skill) {
    if (!window.confirm(`Delete the skill '${skill.name}'? This removes it from this browser.`)) {
      return;
    }
    if (editingSkill?.id === skill.id) {
      closeEditor();
    }
    setSelectedId(null);
    removeSkill(skill.id);
  }

  const isEmpty = skills.length === 0;
  const enabledCount = skills.filter((skill) => skill.isEnabled).length;

  return (
    <>
      <SiteHeader
        actions={
          <Button onClick={openCreate} size="sm" type="button">
            <Plus aria-hidden="true" className="size-3.5" />
            New skill
          </Button>
        }
        status={
          <SiteHeaderStatus>{`${enabledCount} of ${skills.length} enabled`}</SiteHeaderStatus>
        }
      />

      <main className="min-h-0 flex-1 overflow-y-auto bg-background">
        <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-8 lg:px-10 lg:py-8">
          {error ? (
            <div
              className="mb-6 flex items-start gap-3 rounded-lg border border-destructive/30 bg-background px-4 py-3 text-sm text-destructive"
              role="alert"
            >
              <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <p className="min-w-0 flex-1 break-words">{error}</p>
              <Button onClick={() => setError(null)} size="sm" type="button" variant="outline">
                Dismiss
              </Button>
            </div>
          ) : null}

          {isEmpty && editorMode === "closed" ? (
            <div className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-lg border border-dashed border-border px-6 py-16 text-center">
              <BookOpen aria-hidden="true" className="size-8 text-muted-foreground" />
              <h2 className="text-sm font-semibold text-foreground">No skills yet</h2>
              <p className="text-sm text-muted-foreground">
                Skills teach the agent specialized workflows. Each one has a name, a description
                used for discovery, and markdown instructions loaded when the skill is activated.
              </p>
              <Button onClick={openCreate} size="sm" type="button">
                <Plus aria-hidden="true" className="size-3.5" />
                Create your first skill
              </Button>
            </div>
          ) : isEmpty ? (
            <div className="mx-auto max-w-3xl">
              <SkillEditor
                initialDraft={EMPTY_DRAFT}
                key="create-first"
                onCancel={closeEditor}
                onSaved={handleSaved}
                onSubmit={(draft) => createSkill(draft)}
              />
            </div>
          ) : (
            <div className="lg:grid lg:grid-cols-[minmax(16rem,21rem)_minmax(0,1fr)] lg:items-start lg:gap-10">
              <aside className="lg:sticky lg:top-20">
                <p className="px-3 text-xs text-muted-foreground">
                  {skills.length} skill{skills.length === 1 ? "" : "s"}
                </p>
                <ul className="mt-2 space-y-0.5">
                  {skills.map((skill) => {
                    const isSelected = editorMode !== "create" && selectedSkill?.id === skill.id;

                    return (
                      <li key={skill.id}>
                        <button
                          aria-current={isSelected ? "true" : undefined}
                          className={cn(
                            "w-full rounded-md px-3 py-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/30",
                            isSelected ? "bg-muted" : "hover:bg-muted/60",
                          )}
                          onClick={() => selectSkill(skill.id)}
                          type="button"
                        >
                          <span className="flex items-center gap-2">
                            <span
                              aria-hidden="true"
                              className={cn(
                                "size-1.5 shrink-0 rounded-full",
                                skill.isEnabled ? "bg-primary" : "bg-input",
                              )}
                            />
                            <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                              {skill.name}
                            </span>
                            {skill.references.length > 0 ? (
                              <span className="shrink-0 tabular-nums text-[11px] text-muted-foreground">
                                {skill.references.length}{" "}
                                <FileText
                                  aria-hidden="true"
                                  className="inline size-3 align-[-2px]"
                                />
                              </span>
                            ) : null}
                          </span>
                          <span className="mt-0.5 block truncate pl-3.5 text-xs text-muted-foreground">
                            {skill.description}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </aside>

              <div className="mt-8 min-w-0 scroll-mt-32 sm:scroll-mt-20 lg:mt-0" ref={detailRef}>
                {editorMode !== "closed" ? (
                  <SkillEditor
                    initialDraft={editingSkill ? draftFromSkill(editingSkill) : EMPTY_DRAFT}
                    key={editingSkill?.id ?? "create"}
                    onCancel={closeEditor}
                    onSaved={handleSaved}
                    onSubmit={(draft) =>
                      editingSkill
                        ? (updateSkill(editingSkill.id, draft) ?? null)
                        : createSkill(draft)
                    }
                  />
                ) : selectedSkill ? (
                  <SkillDetail
                    onDelete={() => removeSkillWithConfirm(selectedSkill)}
                    onEdit={() => {
                      setEditingSkill(selectedSkill);
                      setEditorMode("edit");
                    }}
                    onToggleEnabled={() => toggleEnabled(selectedSkill)}
                    skill={selectedSkill}
                  />
                ) : null}
              </div>
            </div>
          )}
        </div>
      </main>
    </>
  );
}

function scrollDetailIntoViewOnSmallScreens(ref: React.RefObject<HTMLDivElement | null>) {
  if (typeof window === "undefined" || window.matchMedia("(min-width: 1024px)").matches) {
    return;
  }

  requestAnimationFrame(() => {
    ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

function SkillDetail({
  onDelete,
  onEdit,
  onToggleEnabled,
  skill,
}: {
  onDelete: () => void;
  onEdit: () => void;
  onToggleEnabled: () => void;
  skill: Skill;
}) {
  return (
    <article>
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 border-b border-border pb-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="break-words text-lg font-semibold text-foreground">{skill.name}</h2>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-medium",
                skill.isEnabled ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
              )}
            >
              {skill.isEnabled ? "Enabled" : "Disabled"}
            </span>
          </div>
          <p className="mt-1.5 max-w-[65ch] break-words text-sm leading-6 text-muted-foreground">
            {skill.description}
          </p>
          <CopyableId id={skill.id} label="Skill ID" />
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <Button onClick={onToggleEnabled} size="sm" type="button" variant="ghost">
            {skill.isEnabled ? "Disable" : "Enable"}
          </Button>
          <Button onClick={onEdit} size="sm" type="button" variant="outline">
            Edit
          </Button>
          <Button
            aria-label={`Delete ${skill.name}`}
            className="text-destructive hover:bg-destructive/10"
            onClick={onDelete}
            size="sm"
            type="button"
            variant="ghost"
          >
            <Trash2 aria-hidden="true" className="size-3.5" />
          </Button>
        </div>
      </header>

      <section className="mt-6">
        <h3 className="text-xs font-semibold text-muted-foreground">Instructions</h3>
        {/* Rendered as markdown (the reference uses Streamdown); user-authored
           bodies are trusted local content, so the default no-raw-HTML policy
           is enough. */}
        <div className="mt-3 max-w-[72ch] text-sm leading-6 text-foreground">
          <Markdown>{skill.body}</Markdown>
        </div>
      </section>

      {skill.references.length > 0 ? (
        <section className="mt-10">
          <h3 className="text-xs font-semibold text-muted-foreground">
            References ({skill.references.length})
          </h3>
          <ul className="mt-3 space-y-4">
            {skill.references.map((reference) => (
              <li className="rounded-lg border border-border px-4 py-4 sm:px-5" key={reference.id}>
                <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                  <FileText aria-hidden="true" className="size-3.5 text-muted-foreground" />
                  {reference.name}
                </p>
                <p className="mt-1 max-w-[65ch] text-sm text-muted-foreground">
                  {reference.description}
                </p>
                <CopyableId id={reference.id} label="Reference ID" />
                <div className="mt-3 max-h-72 max-w-[72ch] overflow-auto border-t border-border/70 pt-3 text-sm leading-6 text-foreground">
                  <Markdown>{reference.body}</Markdown>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  );
}

function SkillEditor({
  initialDraft,
  onCancel,
  onSaved,
  onSubmit,
}: {
  initialDraft: SkillDraft;
  onCancel: () => void;
  onSaved: (saved: Skill) => void;
  onSubmit: (draft: CreateSkillPayload) => Skill | null;
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
                    { body: "", description: "", key: nextDraftKey(), name: "" },
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

type CreateSkillPayload = {
  name: string;
  description: string;
  body: string;
  references: { id?: string; name: string; description: string; body: string }[];
};

function Field({
  children,
  counter,
  error,
  hint,
  label,
}: {
  children: (id: string) => React.ReactNode;
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

function CopyableId({ id, label }: { id: string; label: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      className="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-md bg-muted/60 px-2 py-1 text-[11px] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/30"
      onClick={() => {
        void navigator.clipboard.writeText(id).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      title={`Copy ${label}`}
      type="button"
    >
      <Copy aria-hidden="true" className="size-3 shrink-0" />
      <span className="shrink-0 font-medium">{label}</span>
      <code className="truncate font-mono">{copied ? "Copied!" : id}</code>
    </button>
  );
}
