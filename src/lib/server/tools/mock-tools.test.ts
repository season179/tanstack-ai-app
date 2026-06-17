import { describe, expect, it } from "vitest";

import {
  executeMockTool,
  getMockToolFunctionSchema,
  getMockToolParameterSchema,
  getMockToolSpec,
  mockToolCount,
  mockToolHandlers,
  mockToolSpecs,
  type RealisticToolInput,
  type RealisticToolSpec,
} from "~/lib/server/tools/mock-tools";

/**
 * Build a minimal valid RealisticToolSpec for executor/schema fixtures without
 * repeating the seven required fields on every assertion. Spreads ...defaults
 * FIRST so per-test overrides always win (a reversed order silently clobbers).
 */
function spec(overrides: Partial<RealisticToolSpec> = {}): RealisticToolSpec {
  return {
    name: "test_tool",
    title: "Test Tool",
    service: "test",
    action: "do_thing",
    description: "A test tool.",
    properties: {
      name: { type: "string", description: "A name." },
      count: { type: "integer", description: "A count." },
    },
    ...overrides,
  };
}

describe("mock-tools — catalog integrity", () => {
  it("exports exactly 200 tools (the documented checksum)", () => {
    expect(mockToolCount).toBe(200);
    expect(mockToolSpecs).toHaveLength(200);
  });

  it("every spec has the seven required fields populated", () => {
    for (const s of mockToolSpecs) {
      expect(typeof s.name).toBe("string");
      expect(s.name.length).toBeGreaterThan(0);
      expect(typeof s.title).toBe("string");
      expect(s.title.length).toBeGreaterThan(0);
      expect(typeof s.service).toBe("string");
      expect(s.service.length).toBeGreaterThan(0);
      expect(typeof s.action).toBe("string");
      expect(s.action.length).toBeGreaterThan(0);
      expect(typeof s.description).toBe("string");
      expect(s.description.length).toBeGreaterThan(0);
      expect(typeof s.properties).toBe("object");
      expect(s.properties).not.toBeNull();
    }
  });

  it("has no duplicate tool names (the registry's duplicate guard depends on this)", () => {
    const names = mockToolSpecs.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("(service, action) pairs may repeat — uniqueness is keyed by name, not by pair", () => {
    // A service can expose the same action across different named resources
    // (e.g. github.list over repos vs issues), so the (service, action) pair is
    // NOT a uniqueness key. Only `name` is. Pin this so a future "tidy" doesn't
    // accidentally drop tools that share a service+action.
    const pairs = new Set(mockToolSpecs.map((s) => `${s.service}::${s.action}`));
    expect(pairs.size).toBeLessThanOrEqual(mockToolCount);
    expect(pairs.size).toBeGreaterThan(0);
  });

  it("every spec's `required` entries (when present) reference a declared property", () => {
    // A required field that names a non-existent property produces an invalid
    // JSON Schema and can confuse the model's function-calling. This pins the
    // invariant across all 200 specs.
    for (const s of mockToolSpecs) {
      if (!s.required) {
        continue;
      }
      for (const field of s.required) {
        expect(
          Object.hasOwn(s.properties, field),
          `spec "${s.name}" marks "${field}" required but does not declare it`,
        ).toBe(true);
      }
    }
  });

  it("mockToolHandlers maps every catalog spec name to a function", () => {
    expect(Object.keys(mockToolHandlers).length).toBe(mockToolCount);
    for (const s of mockToolSpecs) {
      expect(typeof mockToolHandlers[s.name]).toBe("function");
    }
  });
});

describe("getMockToolSpec", () => {
  it("returns the spec for a known catalog name", () => {
    const first = mockToolSpecs[0];
    expect(first).toBeDefined();
    expect(getMockToolSpec(first.name)).toBe(first);
  });

  it("returns undefined for an unknown name (not a throw)", () => {
    expect(getMockToolSpec("definitely_not_a_real_tool_xyz")).toBeUndefined();
  });

  it("returns undefined for an empty string", () => {
    expect(getMockToolSpec("")).toBeUndefined();
  });
});

describe("getMockToolParameterSchema", () => {
  it("wraps the spec's properties into an object schema with additionalProperties:false", () => {
    const properties = { name: { type: "string", description: "n" } };
    const schema = getMockToolParameterSchema(spec({ properties }));
    expect(schema).toEqual({
      type: "object",
      properties,
      required: undefined,
      additionalProperties: false,
    });
  });

  it("threads the spec's required array through when present", () => {
    const properties = { name: { type: "string", description: "n" } };
    const schema = getMockToolParameterSchema(spec({ properties, required: ["name"] }));
    expect(schema.required).toEqual(["name"]);
  });

  it("returns a stable shape (the same spec input yields a deeply-equal object)", () => {
    const s = spec({ required: ["name"] });
    expect(getMockToolParameterSchema(s)).toEqual(getMockToolParameterSchema(s));
  });
});

describe("getMockToolFunctionSchema", () => {
  it("produces an OpenRouter/OpenAI function-tool shape", () => {
    const s = spec();
    const fn = getMockToolFunctionSchema(s);
    expect(fn).toEqual({
      type: "function",
      function: {
        name: s.name,
        description: s.description,
        parameters: {
          type: "object",
          properties: s.properties,
          required: s.required,
          additionalProperties: false,
        },
      },
    });
  });

  it("the function name matches the spec name (the model calls this)", () => {
    const s = spec({ name: "special_name_42" });
    expect(getMockToolFunctionSchema(s).function.name).toBe("special_name_42");
  });

  it("the parameters block is exactly getMockToolParameterSchema(spec)", () => {
    const s = spec({ required: ["name"] });
    expect(getMockToolFunctionSchema(s).function.parameters).toEqual(getMockToolParameterSchema(s));
  });

  it("every catalog spec produces a well-formed function schema", () => {
    for (const s of mockToolSpecs) {
      const fn = getMockToolFunctionSchema(s);
      expect(fn.type).toBe("function");
      expect(fn.function.name).toBe(s.name);
      expect(fn.function.description).toBe(s.description);
      expect(fn.function.parameters.type).toBe("object");
      expect(fn.function.parameters.additionalProperties).toBe(false);
    }
  });
});

describe("executeMockTool — output shape", () => {
  it("returns a mocked-status result echoing the spec and input", () => {
    const first = mockToolSpecs[0];
    expect(first).toBeDefined();
    const input: RealisticToolInput = { name: "Alice" };
    const out = executeMockTool(first.name, input);
    expect(out).toBeDefined();
    expect(out?.status).toBe("mocked");
    expect(out?.toolName).toBe(first.name);
    expect(out?.service).toBe(first.service);
    expect(out?.action).toBe(first.action);
    expect(out?.receivedInput).toEqual(input);
    expect(out?.summary).toBe(
      `Mocked ${first.service} ${first.action} operation for ${first.name}.`,
    );
  });

  it("returns undefined for an unknown tool name", () => {
    expect(executeMockTool("no_such_tool", { x: 1 })).toBeUndefined();
  });

  it("records is always an array of 3 with unique id/label/url within the call", () => {
    const first = mockToolSpecs[0];
    expect(first).toBeDefined();
    const out = executeMockTool(first.name, { name: "Bob" });
    expect(out?.records).toHaveLength(3);
    const ids: string[] = [];
    const urls: string[] = [];
    for (const [index, record] of (out?.records ?? []).entries()) {
      const n = index + 1;
      expect(record.id).toBe(`${first.service}-${first.action}-${n}`);
      expect(record.label).toContain(`mock ${n}`);
      expect(record.url).toBe(`https://example.invalid/${first.service}/${first.name}/${n}`);
      ids.push(record.id);
      if (typeof record.url === "string") {
        urls.push(record.url);
      }
    }
    // All three ids and urls are distinct within one execution (the index suffix
    // disambiguates records even when two tools share a service+action).
    expect(new Set(ids).size).toBe(3);
    expect(urls).toHaveLength(3);
    expect(new Set(urls).size).toBe(3);
  });

  it("does not mutate the input object", () => {
    const first = mockToolSpecs[0];
    expect(first).toBeDefined();
    const input: RealisticToolInput = { name: "Carol", n: 3 };
    const snapshot = { ...input };
    executeMockTool(first.name, input);
    expect(input).toEqual(snapshot);
  });
});

describe("executeMockTool — record label derivation (buildMockRecords)", () => {
  it("uses the first string-valued input property as the label base", () => {
    const s = mockToolSpecs[0];
    expect(s).toBeDefined();
    const out = executeMockTool(s.name, { count: 5, label: "Primary" });
    // The first string-valued entry wins regardless of key name.
    expect(out?.records[0].label).toBe("Primary mock 1");
  });

  it("uses the first matching string when multiple string values are present", () => {
    const s = mockToolSpecs[0];
    expect(s).toBeDefined();
    // Insertion order: count(never), then first, then second. The first string
    // value encountered in Object.entries order is "First".
    const out = executeMockTool(s.name, { count: 1, first: "First", second: "Second" });
    expect(out?.records[0].label).toBe("First mock 1");
  });

  it("falls back to spec.title when no string-valued input property exists", () => {
    const out = executeMockTool(mockToolSpecs[0].name, { count: 7, enabled: true });
    expect(out?.records[0].label).toBe(`${mockToolSpecs[0].title} mock 1`);
  });

  it("falls back to spec.title when the string value is empty or whitespace", () => {
    const s = mockToolSpecs[0];
    expect(s).toBeDefined();
    const whitespaceOut = executeMockTool(s.name, { name: "   " });
    expect(whitespaceOut?.records[0].label).toBe(`${s.title} mock 1`);
    const emptyOut = executeMockTool(s.name, { name: "" });
    expect(emptyOut?.records[0].label).toBe(`${s.title} mock 1`);
  });

  it("handles an empty input object by falling back to spec.title", () => {
    const s = mockToolSpecs[0];
    expect(s).toBeDefined();
    const out = executeMockTool(s.name, {});
    expect(out?.receivedInput).toEqual({});
    expect(out?.records[0].label).toBe(`${s.title} mock 1`);
  });
});

describe("mockToolHandlers — registry-bound per-name handlers", () => {
  it("each handler dispatches to executeMockTool for its bound name", () => {
    const s = mockToolSpecs[0];
    expect(s).toBeDefined();
    const input: RealisticToolInput = { name: "Dave" };
    const viaHandler = mockToolHandlers[s.name](input);
    const direct = executeMockTool(s.name, input);
    expect(viaHandler).toEqual(direct);
  });

  it("every handler produces a result whose toolName matches its bound spec name", () => {
    for (const s of mockToolSpecs) {
      const result = mockToolHandlers[s.name]({});
      expect(result?.toolName).toBe(s.name);
    }
  });
});
