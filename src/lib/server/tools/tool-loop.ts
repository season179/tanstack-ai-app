/**
 * Hand-rolled, AI-SDK-free agent tool loop. This is the server-side expression
 * of the reference app's core thesis (see PRODUCT.md): keep a large tool
 * registry server-side, expose only a tiny search/describe/call bridge to the
 * model in `search` mode (or every tool in `all` mode), and re-prompt with the
 * tool results until the model produces a text answer.
 *
 * The reference implements this with the AI SDK's ToolLoopAgent; here we drive
 * OpenRouter's OpenAI-compatible function-calling directly: one streaming
 * round-trip per loop iteration, dispatching tool calls through the bridge
 * executors (search mode) or the registry directly (all mode), then appending
 * the assistant tool_calls turn + `tool`-role result messages and looping.
 *
 * Text deltas, tool calls, tool results, and a final token-savings metadata
 * summary are emitted as `ToolLoopEvent`s so the chat route can re-serialize
 * them onto its SSE channel. The client (today) renders only the text deltas;
 * the tool/metadata events are forward-compatible for the chat-UI iteration.
 */

import {
  compactUsage,
  type OpenRouterFunctionTool,
  type OpenRouterMessage,
  type OpenRouterToolCall,
  type OpenRouterTurnUsage,
  streamToolAwareTurn,
  sumUsage,
} from "../openrouter";
import { getMockToolFunctionSchema, type RealisticToolInput } from "./mock-tools";
import { NO_TOOL_CONTEXT, type ToolExecutionContext, toolRegistry } from "./registry";
import type {
  RequestTokenEstimate,
  ToolExposureMode,
  ToolSearchMetadata,
  ToolSearchMode,
  ToolSearchTraceEvent,
} from "./token-usage";
import {
  buildToolSearchMetadata,
  executeToolCall,
  executeToolDescribe,
  executeToolSearch,
  TOOL_CALL_NAME,
  TOOL_DESCRIBE_NAME,
  TOOL_SEARCH_NAME,
} from "./tool-search";

/** Never let a runaway model burn more than this many round-trips per turn. */
const MAX_LOOP_ITERATIONS = 6;

/** Abridged tool-call descriptor emitted to the SSE channel for UI surfacing. */
type ToolCallDescriptor = {
  name: string;
  arguments: unknown;
  service?: string;
  title?: string;
};

/** Abridged tool-result descriptor emitted to the SSE channel. */
type ToolResultDescriptor = {
  name: string;
  ok: boolean;
  output: unknown;
};

export type ToolLoopEvent =
  | { type: "text"; text: string }
  | { type: "tool_call"; call: ToolCallDescriptor }
  | { type: "tool_result"; result: ToolResultDescriptor }
  | { type: "usage"; usage: OpenRouterTurnUsage }
  | { type: "metadata"; metadata: ToolSearchMetadata };

export type ToolLoopOptions = {
  apiKey: string;
  model: string;
  /** Run input including the leading system message. Never mutated. */
  messages: OpenRouterMessage[];
  mode: Exclude<ToolExposureMode, "none">;
  signal?: AbortSignal;
  onEvent: (event: ToolLoopEvent) => void;
  /** Threaded into deferred tool_call execution (scheduler origin, future). */
  toolContext?: ToolExecutionContext;
};

/** System prompt for tool-enabled runs, ported from the reference's chat route. */
const TOOL_SYSTEM_PROMPT = [
  "Be friendly, concise, and helpful.",
  "Use tool_search, tool_describe, and tool_call when hidden tools are needed.",
  "tool_search returns compact matches (name, title, service, score).",
  "tool_describe loads one tool's full parameter schema before you call it.",
  "tool_call runs a deferred tool you have already described.",
].join(" ");

/** The three bridge tools the model sees in `search` mode. Built once. */
const BRIDGE_TOOLS: OpenRouterFunctionTool[] = [
  {
    type: "function",
    function: {
      name: TOOL_SEARCH_NAME,
      description:
        "Search the hidden tool catalog by keyword. Returns compact matches (name, title, service, score) without parameter schemas. Run this before tool_describe or tool_call when you need a capability you cannot see.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Natural-language search over tool names, services, actions, and descriptions.",
          },
          limit: {
            type: "integer",
            description: "Maximum matches to return (1-20). Defaults to 5.",
            minimum: 1,
            maximum: 20,
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
      name: TOOL_DESCRIBE_NAME,
      description:
        "Load the full parameter schema for one tool by exact name. Run tool_search first if you only have a keyword. Returns the JSON Schema you must satisfy to call the tool.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Exact tool name returned by tool_search." },
        },
        required: ["name"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: TOOL_CALL_NAME,
      description:
        "Execute a deferred tool by exact name with JSON arguments. The tool must have been described first so you know its parameters. Returns the tool's output.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Exact tool name to execute." },
          arguments: {
            type: "object",
            description: "Arguments object satisfying the tool's parameter schema.",
            additionalProperties: true,
          },
        },
        required: ["name", "arguments"],
        additionalProperties: false,
      },
    },
  },
];

/** Every catalog tool's function schema, for the `all` baseline. Built once. */
const ALL_TOOLS: OpenRouterFunctionTool[] = toolRegistry.specs.map(
  (spec) => getMockToolFunctionSchema(spec) as OpenRouterFunctionTool,
);

/**
 * Drive the deferred tool-search loop to completion, streaming events to
 * `onEvent`. Always emits a final `metadata` event (even on early exit) so the
 * UI can render the deferred-vs-all token savings for the turn.
 *
 * The contract:
 *  - one upstream streaming request per iteration;
 *  - if the model emits tool_calls, dispatch each through the bridge (search)
 *    or registry (all), emit tool_call + tool_result events, append the
 *    assistant tool_calls turn + tool result messages, and loop;
 *  - once the model replies with text and no tool_calls, stop.
 */
export async function runToolLoop({
  apiKey,
  model,
  messages,
  mode,
  signal,
  onEvent,
  toolContext = NO_TOOL_CONTEXT,
}: ToolLoopOptions): Promise<void> {
  const searchMode: ToolSearchMode = mode;
  const tools = searchMode === "search" ? BRIDGE_TOOLS : ALL_TOOLS;
  const trace: ToolSearchTraceEvent[] = [];
  const requestEstimates: RequestTokenEstimate[] = [];
  const toolSchemaChars = JSON.stringify(tools).length;
  // Real OpenRouter usage summed across every round-trip in the loop. The user
  // sees ONE assistant reply that may have cost N upstream requests (search →
  // describe → call → final answer), so totals are the meaningful number —
  // not any single request's slice.
  let usage: OpenRouterTurnUsage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    reasoningTokens: 0,
    cachedInputTokens: 0,
  };

  // Prepend the tool-aware system prompt (the caller's system message, if any,
  // is preserved after it so skill/scheduler prompts can still ship later).
  const run: OpenRouterMessage[] = [{ role: "system", content: TOOL_SYSTEM_PROMPT }, ...messages];

  const emitMetadata = () => {
    onEvent({
      type: "metadata",
      metadata: buildToolSearchMetadata({
        mode: searchMode,
        requestEstimates,
        sentToolCount: tools.length,
        trace,
      }),
    });
  };

  try {
    for (let iteration = 0; iteration < MAX_LOOP_ITERATIONS; iteration += 1) {
      if (signal?.aborted) {
        break;
      }

      // One schema-cost estimate per upstream request — the bridge measures
      // deferred-vs-all savings from the tool schemas actually sent.
      requestEstimates.push({ toolChars: toolSchemaChars });

      const turn = await streamToolAwareTurn({
        apiKey,
        model,
        messages: run,
        tools,
        signal,
        onText: (delta) => onEvent({ type: "text", text: delta }),
      });

      // Accumulate this round-trip's real usage (undefined if the provider
      // omitted it or the request aborted before the terminal chunk).
      if (turn.usage) {
        usage = sumUsage(usage, compactUsage(turn.usage));
      }

      // No tool calls => this was the final text answer. Done.
      if (turn.toolCalls.length === 0) {
        break;
      }

      // Append the assistant turn (with tool_calls) so the next request can
      // correlate tool results by tool_call_id, then execute + append each.
      run.push({
        role: "assistant",
        content: turn.content,
        tool_calls: turn.toolCalls,
      });

      for (const call of turn.toolCalls) {
        const { descriptor, resultMessage, ok } = await dispatchToolCall(
          call,
          mode,
          trace,
          toolContext,
        );
        onEvent({ type: "tool_call", call: descriptor });
        onEvent({
          type: "tool_result",
          result: { name: descriptor.name, ok, output: resultMessage },
        });
        run.push({
          role: "tool",
          tool_call_id: call.id,
          content: resultMessage,
        });
      }
    }
  } finally {
    // Emit one aggregated usage frame per turn (zeros if the provider never
    // sent usage, e.g. an aborted run), then the deferred-vs-all metadata.
    onEvent({ type: "usage", usage });
    emitMetadata();
  }
}

/**
 * Dispatch one model-emitted tool call. In `search` mode routes through the
 * bridge executors (tool_search / tool_describe / tool_call); in `all` mode
 * dispatches directly through the central registry. Returns the abridged
 * descriptor for the SSE channel plus the JSON string to feed back to the model.
 */
async function dispatchToolCall(
  call: OpenRouterToolCall,
  mode: ToolSearchMode,
  trace: ToolSearchTraceEvent[],
  ctx: ToolExecutionContext,
): Promise<{ descriptor: ToolCallDescriptor; resultMessage: string; ok: boolean }> {
  const name = call.function.name;
  const args = parseArguments(call.function.arguments);

  if (mode === "search") {
    return dispatchBridgeCall(name, args, trace, ctx);
  }

  const spec = toolRegistry.getSpec(name);
  const descriptor: ToolCallDescriptor = {
    name,
    arguments: args,
    service: spec?.service,
    title: spec?.title,
  };

  try {
    const output = await toolRegistry.execute(name, args, ctx);
    if (output === undefined) {
      const message = `Tool '${name}' has no registered handler.`;
      return { descriptor, resultMessage: message, ok: false };
    }
    return { descriptor, resultMessage: safeStringify(output), ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Tool execution failed.";
    return { descriptor, resultMessage: message, ok: false };
  }
}

/** Route a `search`-mode call to its bridge executor. */
async function dispatchBridgeCall(
  name: string,
  args: RealisticToolInput,
  trace: ToolSearchTraceEvent[],
  ctx: ToolExecutionContext,
): Promise<{ descriptor: ToolCallDescriptor; resultMessage: string; ok: boolean }> {
  const descriptor: ToolCallDescriptor = { name, arguments: args };

  try {
    if (name === TOOL_SEARCH_NAME) {
      const result = executeToolSearch(
        {
          query: String(args.query ?? ""),
          limit: typeof args.limit === "number" ? args.limit : undefined,
        },
        trace,
      );
      return { descriptor, resultMessage: safeStringify(result), ok: true };
    }

    if (name === TOOL_DESCRIBE_NAME) {
      const result = executeToolDescribe({ name: String(args.name ?? "") }, trace);
      return { descriptor, resultMessage: safeStringify(result), ok: true };
    }

    if (name === TOOL_CALL_NAME) {
      const toolName = String(args.name ?? "");
      const toolArgs = toToolInput(args.arguments);
      const result = await executeToolCall({ name: toolName, arguments: toolArgs }, trace, ctx);
      return { descriptor, resultMessage: safeStringify(result), ok: true };
    }

    // The model called a non-bridge tool by name while in search mode. Nudge it
    // back to the bridge rather than failing hard — keeps the loop alive.
    const message = `Unknown tool '${name}'. In search mode, call tool_search, tool_describe, or tool_call only.`;
    return { descriptor, resultMessage: message, ok: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bridge tool failed.";
    return { descriptor, resultMessage: message, ok: false };
  }
}

/** Parse the model's tool-call arguments string into a value object. */
function parseArguments(raw: string): RealisticToolInput {
  if (raw.trim().length === 0) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    return toToolInput(parsed);
  } catch {
    // Malformed JSON from the model: surface the raw string so the next round
    // can correct itself instead of crashing the loop.
    return { __rawArguments: raw } as RealisticToolInput;
  }
}

/** Coerce an unknown value into the registry's tool-input shape. */
function toToolInput(value: unknown): RealisticToolInput {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as RealisticToolInput)
    : {};
}

/** JSON.stringify that never throws (cycles / bigints); falls back to String. */
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
