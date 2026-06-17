import { describe, expect, it } from "vitest";
import { parsePartialSkillCommand, parseSkillCommand } from "~/lib/skills/slash-command";
import { NAME_MAX } from "~/lib/skills/validation";

describe("parseSkillCommand", () => {
  it("returns the name for a leading /skill-name followed by a space", () => {
    expect(parseSkillCommand("/pig-latin hello")).toBe("pig-latin");
  });

  it("returns the name at end-of-message (no trailing space)", () => {
    expect(parseSkillCommand("/summarize")).toBe("summarize");
  });

  it("returns null when the slash is not leading", () => {
    expect(parseSkillCommand(" /summarize")).toBeNull();
    expect(parseSkillCommand("hi /summarize")).toBeNull();
  });

  it("returns null for a bare slash", () => {
    expect(parseSkillCommand("/")).toBeNull();
    expect(parseSkillCommand("/ ")).toBeNull();
  });

  it("rejects uppercase in the name", () => {
    expect(parseSkillCommand("/PigLatin hi")).toBeNull();
  });

  it("allows digits and hyphen-separated segments", () => {
    expect(parseSkillCommand("/gpt-4o go")).toBe("gpt-4o");
    expect(parseSkillCommand("/step-1-of-2")).toBe("step-1-of-2");
  });

  it("rejects a trailing hyphen before whitespace", () => {
    expect(parseSkillCommand("/pig- hi")).toBeNull();
  });

  it("rejects names longer than NAME_MAX", () => {
    const tooLong = "a".repeat(NAME_MAX + 1);
    expect(parseSkillCommand(`/${tooLong} hi`)).toBeNull();
  });

  it("accepts a name exactly NAME_MAX long", () => {
    const exact = "a".repeat(NAME_MAX);
    expect(parseSkillCommand(`/${exact} hi`)).toBe(exact);
  });
});

describe("parsePartialSkillCommand", () => {
  it("returns the partial name while the user is still typing", () => {
    expect(parsePartialSkillCommand("/pig")).toBe("pig");
    expect(parsePartialSkillCommand("/pig-")).toBe("pig-");
  });

  it("returns the empty string for a bare slash (autocomplete empty list)", () => {
    expect(parsePartialSkillCommand("/")).toBe("");
  });

  it("returns null once a space follows the command", () => {
    expect(parsePartialSkillCommand("/pig ")).toBeNull();
    expect(parsePartialSkillCommand("/pig latin")).toBeNull();
  });

  it("returns null when the slash is not leading", () => {
    expect(parsePartialSkillCommand(" /pig")).toBeNull();
    expect(parsePartialSkillCommand("hi /pig")).toBeNull();
  });

  it("rejects names longer than NAME_MAX", () => {
    const tooLong = "a".repeat(NAME_MAX + 1);
    expect(parsePartialSkillCommand(`/${tooLong}`)).toBeNull();
  });

  it("returns null for a command-free message", () => {
    expect(parsePartialSkillCommand("hello world")).toBeNull();
    expect(parsePartialSkillCommand("")).toBeNull();
  });
});
