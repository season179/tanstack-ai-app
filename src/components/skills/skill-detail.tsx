import { Copy, FileText, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { Markdown } from "~/components/ui/markdown";
import type { Skill } from "~/lib/hooks/use-skills";
import { cn } from "~/lib/utils";

/**
 * Read-only detail view for a single Skill: header (name + enabled badge +
 * copyable id), markdown-rendered instructions body, and the optional
 * references list (each with its own copyable id + markdown body).
 *
 * Extracted from src/routes/skills.tsx so the detail-presentation contract is
 * unit-testable in isolation, mirroring the chat-message extraction pattern.
 * Zero behavior change.
 */
export function SkillDetail({
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

/**
 * Inline copy-to-clipboard affordance for a skill or reference id. Writes the
 * id to the clipboard on click and flashes a 1.5s "Copied!" confirmation.
 */
export function CopyableId({ id, label }: { id: string; label: string }) {
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
