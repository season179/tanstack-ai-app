import { createFileRoute } from "@tanstack/react-router";
import { AlertCircle, BookOpen, FileText, Plus } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { SiteHeader, SiteHeaderStatus } from "~/components/site-header";
import { SkillDetail } from "~/components/skills/skill-detail";
import { SkillEditor } from "~/components/skills/skill-editor";
import { Button } from "~/components/ui/button";
import { useHydrated } from "~/lib/hooks/use-hydrated";
import { type Skill, useSkills } from "~/lib/hooks/use-skills";
import { draftFromSkill, EMPTY_DRAFT } from "~/lib/skills/skill-draft";
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
    (saved: { id: string }) => {
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
                nextReferenceKey={nextDraftKey}
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
                    nextReferenceKey={nextDraftKey}
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
