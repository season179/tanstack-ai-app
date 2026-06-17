/**
 * Central tool registry, ported from the reference's lib/tools/registry.ts.
 *
 * The reference folds three providers (mock, scheduler, skill) into one flat
 * per-tool dispatch surface. This port wires only the mock provider today
 * (the deferred tool-search bridge's catalog); scheduler and skill providers
 * slot in by appending to `toolProviders` when their handlers land — the
 * ToolRegistry shape and the registry's duplicate/missing-handler guards are
 * unchanged so the integration is additive.
 */

import {
  mockToolHandlers,
  mockToolSpecs,
  type RealisticToolInput,
  type RealisticToolOutput,
  type RealisticToolSpec,
} from "./mock-tools";

/**
 * Context threaded through tool execution. Only scheduler tools will consume it
 * (to append a created task's rounds back into the originating chat); mock tools
 * ignore it. Kept minimal for now and intentionally optional at the call site.
 */
export type ToolExecutionContext = {
  /** Chat session the deferred tool_call originated from. */
  originSessionId?: string | null;
};

export const NO_TOOL_CONTEXT: ToolExecutionContext = { originSessionId: null };

export type ToolHandler = (
  input: RealisticToolInput,
  ctx: ToolExecutionContext,
) => unknown | Promise<unknown>;

export type ToolProvider = {
  specs: RealisticToolSpec[];
  handlers: Record<string, ToolHandler>;
};

export type ToolRegistry = {
  /** Every registered spec, preserving provider registration order. */
  specs: RealisticToolSpec[];
  getSpec: (name: string) => RealisticToolSpec | undefined;
  execute: (
    name: string,
    input: RealisticToolInput,
    ctx: ToolExecutionContext,
  ) => unknown | Promise<unknown>;
};

/**
 * Folds providers into one flat per-tool dispatch surface. Tool names are
 * unique across providers; a collision — or a spec with no registered handler —
 * throws at module load rather than silently shadowing or dropping a tool.
 */
export function createToolRegistry(providers: ToolProvider[]): ToolRegistry {
  const specs: RealisticToolSpec[] = [];
  const specByName = new Map<string, RealisticToolSpec>();
  const executeByName = new Map<string, ToolHandler>();

  for (const provider of providers) {
    for (const spec of provider.specs) {
      if (specByName.has(spec.name)) {
        throw new Error(`Duplicate tool name '${spec.name}' registered in the tool registry.`);
      }

      const handler = Object.hasOwn(provider.handlers, spec.name)
        ? provider.handlers[spec.name]
        : undefined;

      if (!handler) {
        throw new Error(`Tool '${spec.name}' has a spec but no registered handler.`);
      }

      specs.push(spec);
      specByName.set(spec.name, spec);
      executeByName.set(spec.name, handler);
    }
  }

  return {
    specs,
    getSpec: (name) => specByName.get(name),
    execute: (name, input, ctx) => executeByName.get(name)?.(input, ctx),
  };
}

/** Mock tools wrapped to ignore the (future) execution context. */
const mockProvider: ToolProvider = {
  specs: mockToolSpecs,
  handlers: Object.fromEntries(
    Object.entries(mockToolHandlers).map(([name, handler]) => [
      name,
      ((input: RealisticToolInput): RealisticToolOutput | undefined =>
        handler(input)) as ToolHandler,
    ]),
  ),
};

/**
 * Provider registration order matches the reference's catalog concatenation
 * (mock, then scheduler, then skill) so deferred-tool search keeps its
 * tie-break ordering once the other providers land.
 */
const toolProviders: ToolProvider[] = [mockProvider];

/** Single registry the deferred tool_call path dispatches through. */
export const toolRegistry = createToolRegistry(toolProviders);
