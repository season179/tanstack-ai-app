import { describe, expect, it } from "vitest";

import {
  executeMockTool,
  mockToolCount,
  mockToolSpecs,
  type RealisticToolInput,
  type RealisticToolOutput,
  type RealisticToolSpec,
} from "~/lib/server/tools/mock-tools";
import {
  createToolRegistry,
  NO_TOOL_CONTEXT,
  type ToolExecutionContext,
  type ToolProvider,
  toolRegistry,
} from "~/lib/server/tools/registry";

/** Minimal valid spec builder for fixtures (avoids repeating 6 required fields). */
function spec(name: string, overrides: Partial<RealisticToolSpec> = {}): RealisticToolSpec {
  return {
    name,
    title: `${name} title`,
    service: "svc",
    action: "act",
    description: `${name} description`,
    properties: {},
    ...overrides,
  };
}

/** A handler that records its (input, ctx) so tests can assert both thread through. */
function recordingHandler(
  calls: Array<{ input: RealisticToolInput; ctx: ToolExecutionContext }>,
): (input: RealisticToolInput, ctx: ToolExecutionContext) => string {
  return (input, ctx) => {
    calls.push({ input, ctx });
    return "ok";
  };
}

describe("createToolRegistry — empty input", () => {
  it("returns an empty spec list for no providers", () => {
    const registry = createToolRegistry([]);
    expect(registry.specs).toEqual([]);
  });

  it("returns undefined from getSpec for any name when empty", () => {
    const registry = createToolRegistry([]);
    expect(registry.getSpec("anything")).toBeUndefined();
  });

  it("returns undefined (not throws) from execute for an unknown name when empty", () => {
    const registry = createToolRegistry([]);
    expect(registry.execute("anything", {}, NO_TOOL_CONTEXT)).toBeUndefined();
  });
});

describe("createToolRegistry — basic dispatch", () => {
  it("registers a spec from a single provider and preserves it in .specs", () => {
    const s = spec("alpha");
    const provider: ToolProvider = { specs: [s], handlers: { alpha: () => "r" } };
    const registry = createToolRegistry([provider]);
    expect(registry.specs).toEqual([s]);
  });

  it("getSpec resolves a registered name to the exact spec object", () => {
    const s = spec("alpha");
    const provider: ToolProvider = { specs: [s], handlers: { alpha: () => "r" } };
    const registry = createToolRegistry([provider]);
    expect(registry.getSpec("alpha")).toBe(s);
  });

  it("getSpec returns undefined for an unknown name", () => {
    const provider: ToolProvider = { specs: [spec("alpha")], handlers: { alpha: () => "r" } };
    const registry = createToolRegistry([provider]);
    expect(registry.getSpec("missing")).toBeUndefined();
  });

  it("execute dispatches to the registered handler and returns its value", () => {
    const provider: ToolProvider = {
      specs: [spec("alpha")],
      handlers: { alpha: (input) => ({ echo: input }) },
    };
    const registry = createToolRegistry([provider]);
    const result = registry.execute("alpha", { q: "hi" }, NO_TOOL_CONTEXT);
    expect(result).toEqual({ echo: { q: "hi" } });
  });

  it("execute threads the ToolExecutionContext through to the handler", () => {
    const seen: Array<{ input: RealisticToolInput; ctx: ToolExecutionContext }> = [];
    const provider: ToolProvider = {
      specs: [spec("alpha")],
      handlers: { alpha: recordingHandler(seen) },
    };
    const registry = createToolRegistry([provider]);
    const ctx: ToolExecutionContext = { originSessionId: "sess-123" };
    registry.execute("alpha", { x: 1 }, ctx);
    expect(seen).toEqual([{ input: { x: 1 }, ctx: { originSessionId: "sess-123" } }]);
  });

  it("execute returns undefined for an unknown name (no throw)", () => {
    const provider: ToolProvider = { specs: [spec("alpha")], handlers: { alpha: () => "r" } };
    const registry = createToolRegistry([provider]);
    expect(registry.execute("missing", {}, NO_TOOL_CONTEXT)).toBeUndefined();
  });

  it("propagates handler errors (does not swallow them)", () => {
    const provider: ToolProvider = {
      specs: [spec("alpha")],
      handlers: {
        alpha: () => {
          throw new Error("boom");
        },
      },
    };
    const registry = createToolRegistry([provider]);
    expect(() => registry.execute("alpha", {}, NO_TOOL_CONTEXT)).toThrow("boom");
  });

  it("awaits an async handler", async () => {
    const provider: ToolProvider = {
      specs: [spec("alpha")],
      handlers: { alpha: async () => "async-ok" },
    };
    const registry = createToolRegistry([provider]);
    await expect(registry.execute("alpha", {}, NO_TOOL_CONTEXT)).resolves.toBe("async-ok");
  });
});

describe("createToolRegistry — provider ordering", () => {
  it("preserves specs in provider registration order across providers", () => {
    const a = spec("a");
    const b = spec("b");
    const c = spec("c");
    const registry = createToolRegistry([
      { specs: [a], handlers: { a: () => "a" } },
      { specs: [b, c], handlers: { b: () => "b", c: () => "c" } },
    ]);
    expect(registry.specs.map((s) => s.name)).toEqual(["a", "b", "c"]);
  });

  it("preserves intra-provider spec order", () => {
    const registry = createToolRegistry([
      {
        specs: [spec("x"), spec("y"), spec("z")],
        handlers: { x: () => "x", y: () => "y", z: () => "z" },
      },
    ]);
    expect(registry.specs.map((s) => s.name)).toEqual(["x", "y", "z"]);
  });
});

describe("createToolRegistry — wiring-bug guards", () => {
  it("throws on a duplicate tool name across two providers", () => {
    expect(() =>
      createToolRegistry([
        { specs: [spec("dup")], handlers: { dup: () => "1" } },
        { specs: [spec("dup")], handlers: { dup: () => "2" } },
      ]),
    ).toThrow(/Duplicate tool name 'dup'/);
  });

  it("throws on a duplicate tool name within the same provider", () => {
    expect(() =>
      createToolRegistry([
        {
          specs: [spec("dup"), spec("dup")],
          handlers: { dup: () => "1" },
        },
      ]),
    ).toThrow(/Duplicate tool name 'dup'/);
  });

  it("throws when a spec has no matching handler in its provider", () => {
    expect(() => createToolRegistry([{ specs: [spec("orphan")], handlers: {} }])).toThrow(
      /Tool 'orphan' has a spec but no registered handler/,
    );
  });

  it("does NOT resolve an Object.prototype-named spec against inherited members (Object.hasOwn guard)", () => {
    // The reference's load-bearing comment: a spec named "toString" with an
    // empty handlers object must NOT resolve `handlers.toString` (inherited
    // from Object.prototype) and silently bypass the missing-handler guard.
    // Object.hasOwn({}, "toString") === false → the guard fires.
    expect(() => createToolRegistry([{ specs: [spec("toString")], handlers: {} }])).toThrow(
      /Tool 'toString' has a spec but no registered handler/,
    );
  });

  it("DOES register a spec whose name shadows Object.prototype when explicitly owned", () => {
    // The flip side: if the provider explicitly owns the key, hasOwn is true
    // and the tool registers normally (no false rejection).
    const registry = createToolRegistry([
      {
        specs: [spec("toString")],
        handlers: { toString: () => "shadowed" },
      },
    ]);
    expect(registry.getSpec("toString")).toBeDefined();
    expect(registry.execute("toString", {}, NO_TOOL_CONTEXT)).toBe("shadowed");
  });

  it("validates every provider before any dispatch is possible (fail-fast at construction)", () => {
    // A later duplicate should reject the whole registry even though an earlier
    // provider was valid — construction is atomic.
    expect(() =>
      createToolRegistry([
        { specs: [spec("ok")], handlers: { ok: () => "ok" } },
        { specs: [spec("dup")], handlers: { dup: () => "1" } },
        { specs: [spec("dup")], handlers: { dup: () => "2" } },
      ]),
    ).toThrow(/Duplicate tool name 'dup'/);
  });
});

describe("createToolRegistry — multiple independent registries", () => {
  it("does not share state across constructed registries", () => {
    const first = createToolRegistry([
      { specs: [spec("only-in-first")], handlers: { "only-in-first": () => "1" } },
    ]);
    const second = createToolRegistry([
      { specs: [spec("only-in-second")], handlers: { "only-in-second": () => "2" } },
    ]);
    expect(first.getSpec("only-in-second")).toBeUndefined();
    expect(second.getSpec("only-in-first")).toBeUndefined();
    expect(first.specs.map((s) => s.name)).toEqual(["only-in-first"]);
    expect(second.specs.map((s) => s.name)).toEqual(["only-in-second"]);
  });
});

describe("toolRegistry singleton (mock provider wiring)", () => {
  it("exports a registry whose spec count matches mockToolCount (the 200-tool checksum)", () => {
    expect(toolRegistry.specs.length).toBe(mockToolCount);
    expect(mockToolCount).toBe(200);
  });

  it("every spec in the singleton resolves through getSpec", () => {
    for (const s of toolRegistry.specs) {
      expect(toolRegistry.getSpec(s.name)).toBe(s);
    }
  });

  it("every spec in the singleton dispatches execute without returning undefined", () => {
    // The mock handler wrapping ignores ctx and delegates to executeMockTool,
    // which always returns a RealisticToolOutput for a registered name.
    for (const s of toolRegistry.specs) {
      const output = toolRegistry.execute(s.name, {}, NO_TOOL_CONTEXT);
      expect(output).toBeDefined();
      const result = output as RealisticToolOutput;
      expect(result.status).toBe("mocked");
      expect(result.toolName).toBe(s.name);
    }
  });

  it("the singleton's execute output matches executeMockTool for the same name + input", () => {
    // Guard the indexed access so biome stays happy and the test stays correct
    // even if the catalog were ever empty.
    const first = mockToolSpecs[0];
    expect(first).toBeDefined();
    if (!first) return;
    const name = first.name;
    const input: RealisticToolInput = { query: "fixture", owner: "acme" };
    const direct = executeMockTool(name, input);
    const viaRegistry = toolRegistry.execute(name, input, NO_TOOL_CONTEXT) as
      | RealisticToolOutput
      | undefined;
    expect(viaRegistry).toEqual(direct);
  });

  it("rejects an unknown name via execute (undefined, not throw) on the singleton", () => {
    expect(toolRegistry.execute("not-a-real-tool", {}, NO_TOOL_CONTEXT)).toBeUndefined();
  });
});
