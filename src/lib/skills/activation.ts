import type { Skill } from "~/lib/skills/skills-store";

/**
 * Client-side activation helpers: turn a localStorage Skill into the
 * `<skill_content>` instruction block that gets prepended to the user's
 * message on the wire, so the model receives the skill's instructions
 * directly without a tool round-trip (the reference's tier-2 activation).
 *
 * Adapted from the reference app's lib/skills/catalog.ts activateSkill(): the
 * format is identical (`<skill_content name=... id=...>` + body + a
 * `<skill_references>` list), only the data source differs — a local Skill
 * row instead of a Postgres one. References are listed (not eagerly loaded)
 * because this port has no on-demand reference tool; the model simply sees
 * them inline. Disabled skills never activate (callers should pre-filter).
 */

const QUOTE = String.fromCharCode(34);
const APOS = String.fromCharCode(39);

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll(QUOTE, "&quot;")
    .replaceAll(APOS, "&apos;");
}

/**
 * Builds the instruction block prepended to the activating user message.
 * Returns null for a skill with no body so a blank skill is a no-op.
 */
export function buildActivatedSkillContent(skill: Skill): string | null {
  if (skill.body.trim().length === 0) {
    return null;
  }

  const referenceList =
    skill.references.length === 0
      ? ""
      : `\n\n<skill_references>\n${skill.references
          .map(
            (reference) =>
              `  <reference id="${escapeXml(reference.id)}" name="${escapeXml(reference.name)}">${escapeXml(reference.description)}</reference>`,
          )
          .join("\n")}\n</skill_references>`;

  return `<skill_content name="${escapeXml(skill.name)}" id="${escapeXml(skill.id)}">\n${skill.body}${referenceList}\n</skill_content>`;
}

/**
 * Resolves a slash-command name to an enabled skill the user can activate.
 * Name matching is case-insensitive on the stored name; returns null for an
 * unknown or disabled skill so the caller fails soft (the raw /command text
 * is sent through unchanged and the model treats it as ordinary text).
 */
export function findActivatableSkill(skills: Skill[], name: string): Skill | null {
  const lower = name.toLowerCase();
  return skills.find((skill) => skill.isEnabled && skill.name === lower) ?? null;
}
