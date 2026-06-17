/**
 * Client-side skills store, backed by localStorage with an in-memory pub/sub.
 *
 * The reference app backs skills with Postgres + Drizzle (a full
 * catalog/activation/resource tier system that the agent loads at runtime).
 * For this TanStack port we keep the same data *shape* (skill + nested
 * references, enabled flag, timestamps) but persist to localStorage — the
 * brief is "no Next.js, no AI SDK", and dragging in a database for a
 * browser-only parity build would dwarf the feature. The store mirrors the
 * sessions-store pattern: referentially-stable cached snapshot, cross-tab
 * storage-event wiring, and an in-memory listener set for same-tab sync.
 */

const SKILLS_KEY = "tanstack-ai-app:skills";

export type SkillReference = {
  id: string;
  name: string;
  description: string;
  body: string;
  createdAt: string;
  updatedAt: string;
};

export type Skill = {
  id: string;
  name: string;
  description: string;
  body: string;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
  references: SkillReference[];
};

export type SkillReferenceInput = {
  /** Present when updating an existing reference; omitted for new ones. */
  id?: string;
  name: string;
  description: string;
  body: string;
};

export type CreateSkillInput = {
  name: string;
  description: string;
  body: string;
  references?: SkillReferenceInput[];
};

export type UpdateSkillInput = {
  name?: string;
  description?: string;
  body?: string;
  isEnabled?: boolean;
  /**
   * Replace-set semantics: when provided, references with an id are kept,
   * ones without an id are created, and live references missing from the
   * list are dropped — mirroring the reference app's behavior.
   */
  references?: SkillReferenceInput[];
};

type Listener = () => void;

const listeners = new Set<Listener>();
let cache: Skill[] | null = null;
let crossTabWired = false;

function isClient(): boolean {
  return typeof window !== "undefined";
}

function parse(raw: string | null, fallback: unknown): unknown {
  if (!raw) {
    return fallback;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function isValidReference(value: unknown): value is SkillReference {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.name === "string" &&
    typeof v.description === "string" &&
    typeof v.body === "string" &&
    typeof v.createdAt === "string" &&
    typeof v.updatedAt === "string"
  );
}

function isValidSkill(value: unknown): value is Skill {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.name === "string" &&
    typeof v.description === "string" &&
    typeof v.body === "string" &&
    typeof v.isEnabled === "boolean" &&
    typeof v.createdAt === "string" &&
    typeof v.updatedAt === "string" &&
    Array.isArray(v.references) &&
    v.references.every(isValidReference)
  );
}

function readSkillsRaw(): Skill[] {
  if (!isClient()) {
    return [];
  }
  const parsed = parse(window.localStorage.getItem(SKILLS_KEY), []);
  if (!Array.isArray(parsed)) {
    return [];
  }
  // Newest-created first (matches the reference's catalog ordering intent and
  // keeps the list stable across edits that only bump updatedAt).
  return parsed.filter(isValidSkill).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function flush(next: Skill[]): void {
  if (!isClient()) {
    return;
  }
  try {
    window.localStorage.setItem(SKILLS_KEY, JSON.stringify(next));
  } catch {
    // Quota / private mode — best effort; in-memory subscribers still update.
  }
  cache = null;
  notify();
}

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

/** Wire the cross-tab `storage` listener exactly once per tab. */
function ensureCrossTab(): void {
  if (!isClient() || crossTabWired) {
    return;
  }
  crossTabWired = true;
  window.addEventListener("storage", (event) => {
    if (event.key === null || event.key === SKILLS_KEY) {
      cache = null;
      notify();
    }
  });
}

function newId(): string {
  if (isClient() && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

// --- Snapshot for useSyncExternalStore (must be referentially stable) -----

export function getSkillsSnapshot(): Skill[] {
  ensureCrossTab();
  if (cache === null) {
    cache = readSkillsRaw();
  }
  return cache;
}

export function subscribeSkills(listener: Listener): () => void {
  ensureCrossTab();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// --- Public mutators -------------------------------------------------------

export function getSkill(id: string): Skill | null {
  return getSkillsSnapshot().find((skill) => skill.id === id) ?? null;
}

export function createSkill(input: CreateSkillInput): Skill {
  const now = nowIso();
  const skill: Skill = {
    id: newId(),
    name: input.name,
    description: input.description,
    body: input.body,
    isEnabled: true,
    createdAt: now,
    updatedAt: now,
    references: (input.references ?? []).map((reference) => ({
      id: newId(),
      name: reference.name,
      description: reference.description,
      body: reference.body,
      createdAt: now,
      updatedAt: now,
    })),
  };
  flush([skill, ...getSkillsSnapshot()]);
  return skill;
}

export function updateSkill(id: string, input: UpdateSkillInput): Skill | null {
  const current = getSkill(id);
  if (!current) {
    return null;
  }

  const now = nowIso();
  const next: Skill = {
    ...current,
    name: input.name ?? current.name,
    description: input.description ?? current.description,
    body: input.body ?? current.body,
    isEnabled: input.isEnabled ?? current.isEnabled,
    updatedAt: now,
  };

  if (input.references) {
    const liveById = new Map(current.references.map((reference) => [reference.id, reference]));
    const merged: SkillReference[] = [];

    for (const incoming of input.references) {
      if (incoming.id && liveById.has(incoming.id)) {
        const existing = liveById.get(incoming.id) as SkillReference;
        merged.push({
          ...existing,
          name: incoming.name,
          description: incoming.description,
          body: incoming.body,
          updatedAt: now,
        });
      } else {
        merged.push({
          id: newId(),
          name: incoming.name,
          description: incoming.description,
          body: incoming.body,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
    // References missing from the input are simply dropped (replace-set).
    next.references = merged;
  }

  flush(getSkillsSnapshot().map((skill) => (skill.id === id ? next : skill)));
  return next;
}

export function deleteSkill(id: string): void {
  flush(getSkillsSnapshot().filter((skill) => skill.id !== id));
}
