/**
 * Server-side skill tools (`skill_search`, `skill_get_content`), ported from
 * the reference's lib/skills/tool-specs.ts + lib/skills/catalog.ts with no AI
 * SDK. The reference loads skills from Postgres; this port receives a
 * per-request catalog snapshot from the client (skills live in browser
 * localStorage), so the tools operate over that snapshot read-only.
 *
 * Exposed alongside the deferred tool-search bridge (or the full mock catalog
 * in `all` mode) so the model can recognize skills in the `<available_skills>`
 * catalog block and load their instructions on demand — the same progressive-
 * disclosure tier system the reference ships (tier-1 catalog → tier-2
 * activation → tier-3 references), just backed by a wire snapshot.
 */

import type { Skill } from "~/lib/skills/skills-store";
import type { OpenRouterFunctionTool } from "../openrouter";

/**
 * Minimal catalog row sent over the wire from the client's localStorage
 * snapshot. Strips the timestamps + isEnabled flag (the snapshot is already
 * pre-filtered to enabled skills) and keeps just the fields the tools need.
 */
export type SkillCatalogSnapshot = {
  id: string;
  name: string;
  description: string;
  body: string;
  references: Array<{
    id: string;
    name: string;
    description: string;
    body: string;
  }>;
};

const SEARCH_LIMIT_DEFAULT = 10;
const SEARCH_LIMIT_MAX = 20;
const TOKEN_RE = /[A-Za-z0-9]+/g;
const QUOTE = String.fromCharCode(34);
const APOS = String.fromCharCode(39);

export const SKILL_SEARCH_NAME = "skill_search";
export const SKILL_GET_CONTENT_NAME = "skill_get_content";

/**
 * System-prompt fragment appended when skill tools are exposed. Ported from
 * the reference's SKILLS_PROMPT, with the file-path / agent-id references
 * trimmed to match the localStorage + wire-snapshot data model.
 */
export const SKILLS_PROMPT = [
  "You have Agent Skills; the enabled ones are listed in <available_skills> with their ids.",
  "When a request matches a skill's description, call skill_get_content with the skill id to load its instructions before doing the work, and follow them.",
  "A loaded skill may list reference documents in <skill_references>; load a reference with skill_get_content by its id only when the instructions call for it.",
  "Use skill_search to find skills by description when the catalog is not enough.",
  "When skill_search returns a reference, load its parent skill's instructions before the reference.",
  "The user can also activate a skill explicitly by starting a message with /skill-name; in that case the skill's <skill_content> is embedded directly in the user message and you should NOT call skill_get_content for it.",
].join(" ");

/** Filter to enabled + build the wire snapshot shape (strips timestamps). */
export function buildSkillCatalogSnapshot(skills: Skill[]): SkillCatalogSnapshot[] {
  return skills
    .filter((skill) => skill.isEnabled)
    .map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      body: skill.body,
      references: skill.references.map((reference) => ({
        id: reference.id,
        name: reference.name,
        description: reference.description,
        body: reference.body,
      })),
    }));
}

/** Tier-1 catalog block for the system prompt. Empty string when no skills. */
export function buildSkillCatalogBlock(skills: SkillCatalogSnapshot[]): string {
  if (skills.length === 0) {
    return "";
  }
  const items = skills
    .map(
      (skill) =>
        `  <skill>\n    <id>${skill.id}</id>\n    <name>${escapeXml(skill.name)}</name>\n    <description>${escapeXml(skill.description)}</description>\n  </skill>`,
    )
    .join("\n");
  return `<available_skills>\n${items}\n</available_skills>`;
}

/**
 * The two function-tool definitions. Static — they don't depend on the
 * snapshot (the snapshot is threaded through `executeSkillTool` at dispatch
 * time), so a single shared array is fine.
 */
const SKILL_TOOLS: OpenRouterFunctionTool[] = [
  {
    type: "function",
    function: {
      name: SKILL_SEARCH_NAME,
      description:
        "Search this agent's skills by matching the query against skill descriptions. Returns matching skills and their reference documents with their ids. Load the content of a hit with skill_get_content.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Text matched against skill and reference descriptions.",
          },
          limit: {
            type: "integer",
            description: `Maximum number of matches to return. Default ${SEARCH_LIMIT_DEFAULT}.`,
            minimum: 1,
            maximum: SEARCH_LIMIT_MAX,
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: SKILL_GET_CONTENT_NAME,
      description:
        "Load the body content of a skill or reference document by its id. Skill ids come from the <available_skills> catalog or skill_search; reference ids are listed inside a loaded skill's <skill_references>.",
      parameters: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "Id of the skill or reference to load.",
          },
        },
        required: ["id"],
        additionalProperties: false,
      },
    },
  },
];

export function buildSkillTools(): OpenRouterFunctionTool[] {
  return SKILL_TOOLS;
}

export type SkillToolResult =
  | { success: true; [key: string]: unknown }
  | { success: false; error: string };

/**
 * Dispatch a skill tool call over the snapshot. The bridge / tool loop calls
 * this for any tool name in `buildSkillTools()`; unknown names return a soft
 * error so the model can self-correct on the next round rather than crashing
 * the loop.
 */
export function executeSkillTool(
  name: string,
  args: Record<string, unknown>,
  snapshot: SkillCatalogSnapshot[],
): SkillToolResult {
  if (name === SKILL_SEARCH_NAME) {
    return executeSkillSearch(args, snapshot);
  }
  if (name === SKILL_GET_CONTENT_NAME) {
    return executeSkillGetContent(args, snapshot);
  }
  return { success: false, error: `'${name}' is not a skill tool.` };
}

function executeSkillSearch(
  args: Record<string, unknown>,
  snapshot: SkillCatalogSnapshot[],
): SkillToolResult {
  const query = typeof args.query === "string" ? args.query.trim() : "";
  if (query.length === 0) {
    return { success: false, error: "query is required." };
  }
  const limit = clampLimit(args.limit);
  const matches = searchSkills(query, snapshot, limit);
  return {
    success: true,
    query,
    count: matches.length,
    matches,
    note:
      matches.length === 0
        ? "No skill descriptions matched. Try broader keywords."
        : "Call skill_get_content with a match id to load its content.",
  };
}

function executeSkillGetContent(
  args: Record<string, unknown>,
  snapshot: SkillCatalogSnapshot[],
): SkillToolResult {
  // The catalog block prints ids verbatim and UUIDs are already lowercase,
  // but case-insensitive compare survives a model that uppercased an id.
  const id = typeof args.id === "string" ? args.id.trim().toLowerCase() : "";
  if (id.length === 0) {
    return { success: false, error: "id is required." };
  }

  for (const skill of snapshot) {
    if (skill.id.toLowerCase() === id) {
      return { success: true, id: skill.id, content: formatSkillContent(skill) };
    }
    for (const reference of skill.references) {
      if (reference.id.toLowerCase() === id) {
        return {
          success: true,
          id: reference.id,
          content: formatReferenceContent(reference),
        };
      }
    }
  }

  return {
    success: false,
    error: `No enabled skill or reference with id '${id}' was found. It may have been disabled or deleted; use skill_search or the <available_skills> catalog to find a current id.`,
  };
}

/** Tier-2 activation: full instructions + references listed (not eagerly loaded). */
function formatSkillContent(skill: SkillCatalogSnapshot): string {
  const referenceList =
    skill.references.length === 0
      ? ""
      : `\n\n<skill_references>\n${skill.references
          .map(
            (reference) =>
              `  <reference id="${reference.id}" name="${escapeXml(reference.name)}">${escapeXml(reference.description)}</reference>`,
          )
          .join(
            "\n",
          )}\n</skill_references>\nLoad a reference by its id when the instructions call for it.`;
  return `<skill_content name="${escapeXml(skill.name)}" id="${skill.id}">\n${skill.body}${referenceList}\n</skill_content>`;
}

/** Tier-3 resource: a single reference document body. */
function formatReferenceContent(reference: SkillCatalogSnapshot["references"][number]): string {
  return `<reference_content name="${escapeXml(reference.name)}" id="${reference.id}">\n${reference.body}\n</reference_content>`;
}

/**
 * Substring-weighted search over the catalog. Skill catalogs are small
 * (typically <20 user-authored skills), so a token-overap ranker is more
 * appropriate than the BM25 the 200-tool mock catalog uses — it's
 * deterministic, fast, and orders exact-name hits ahead of description hits.
 */
function searchSkills(
  query: string,
  snapshot: SkillCatalogSnapshot[],
  limit: number,
): Array<{
  id: string;
  name: string;
  description: string;
  references: Array<{ id: string; name: string; description: string }>;
}> {
  const queryTokens = Array.from(new Set(tokenize(query)));
  if (queryTokens.length === 0) {
    return [];
  }

  const scored = snapshot.map((skill) => {
    const haystack = `${skill.name} ${skill.description}`.toLowerCase();
    let score = 0;
    for (const token of queryTokens) {
      if (haystack.includes(token)) {
        score += 1;
      }
    }
    // Exact-name match is the strongest signal a user-authored skill is the
    // intended hit; weight it above description token overlap.
    if (skill.name.toLowerCase().includes(query.toLowerCase())) {
      score += queryTokens.length;
    }
    return { skill, score };
  });

  return scored
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name))
    .slice(0, limit)
    .map((hit) => ({
      id: hit.skill.id,
      name: hit.skill.name,
      description: hit.skill.description,
      references: hit.skill.references.map((reference) => ({
        id: reference.id,
        name: reference.name,
        description: reference.description,
      })),
    }));
}

function tokenize(text: string): string[] {
  return (text.match(TOKEN_RE) ?? []).map((token) => token.toLowerCase());
}

function clampLimit(value: unknown): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim().length > 0
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(parsed)) {
    return SEARCH_LIMIT_DEFAULT;
  }
  return Math.max(1, Math.min(SEARCH_LIMIT_MAX, Math.trunc(parsed)));
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll(QUOTE, "&quot;")
    .replaceAll(APOS, "&apos;");
}
