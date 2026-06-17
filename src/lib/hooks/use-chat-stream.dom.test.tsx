// @vitest-environment jsdom
//
// Hook tests for useChatStream — the client chat runtime that drives
// fetch('/api/chat') SSE folding, localStorage transcript persistence, first-
// turn AI titling, and send/regenerate/stop. This is the highest-value hook
// in the app: iterations 7/12/18/27/31 all fixed real bugs in it (StrictMode
// localStorage wipe, cross-component setState, empty-placeholder persistence,
// regenerate context, live-merge). The hook reads + writes the real
// sessions-store, so each test resets module state (vi.resetModules + dynamic
// import for a fresh module singleton) and clears localStorage, mirroring the
// store dom-test harness from iteration 47. fetch is mocked at the global
// boundary to return scripted SSE bodies; the real sse-reader folds them.
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatMessage } from "~/lib/hooks/use-chat-stream";
import type { Skill } from "~/lib/skills/skills-store";

/** Build a Response whose body is an SSE stream of the given frame objects. */
function sseResponse(
  frames: Array<Record<string, unknown>>,
  init: { ok?: boolean; status?: number } = {},
): Response {
  const ok = init.ok ?? true;
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  for (const frame of frames) {
    chunks.push(encoder.encode(`data: ${JSON.stringify(frame)}\n`));
  }
  chunks.push(encoder.encode("data: [DONE]\n"));
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
  return {
    ok,
    status: init.status ?? (ok ? 200 : 500),
    body: stream,
    json: async () => ({ error: "boom" }),
  } as unknown as Response;
}

function jsonOk(body: unknown): Response {
  return { ok: true, json: async () => body } as unknown as Response;
}

/** A scripted fetch that maps URL → Response factory. */
function mockFetch(routes: Record<string, () => Response | Promise<Response>>): {
  calls: { url: string; body: unknown }[];
} {
  const calls: { url: string; body: unknown }[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      let body: unknown;
      try {
        body = init?.body ? JSON.parse(String(init.body)) : undefined;
      } catch {
        body = String(init?.body);
      }
      calls.push({ url, body });
      const factory = Object.entries(routes).find(([prefix]) => url.startsWith(prefix))?.[1];
      if (!factory) {
        throw new Error(`No mock for ${url}`);
      }
      return factory();
    },
  );
  return { calls };
}

async function importFresh<T>(modulePath: string): Promise<T> {
  vi.resetModules();
  return (await import(modulePath)) as T;
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useChatStream send happy path", () => {
  it("streams an assistant reply and persists the final transcript", async () => {
    const { calls } = mockFetch({
      "/api/chat": () =>
        sseResponse([
          { type: "text", text: "Hello" },
          { type: "text", text: " world" },
        ]),
      "/api/title": () => jsonOk({ title: "Greeting" }),
    });

    const store = await importFresh<typeof import("~/lib/chat/sessions-store")>(
      "~/lib/chat/sessions-store",
    );
    const { useChatStream } = await importFresh<typeof import("~/lib/hooks/use-chat-stream")>(
      "~/lib/hooks/use-chat-stream",
    );
    const session = store.createSession();
    const sessionId = session.id;

    const { result } = renderHook(() => useChatStream(sessionId));
    await waitFor(() => expect(result.current.messages).toEqual([]));

    act(() => {
      result.current.send("hi");
    });
    // The scripted SSE stream resolves within a single microtask flush, so the
    // submitted -> streaming -> ready transitions happen fast; just wait for the
    // settled state (the intermediate "streaming" is not reliably observable
    // against a synchronous mock).
    await waitFor(() => expect(result.current.status).toBe("ready"));

    const messages = result.current.messages;
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toBe("hi");
    expect(messages[1].role).toBe("assistant");
    expect(messages[1].content).toBe("Hello world");

    // Final transcript persisted to localStorage (without the empty placeholder).
    const persisted = store.readMessages(sessionId);
    expect(persisted).toHaveLength(2);
    expect(persisted[1].content).toBe("Hello world");

    // Exactly one chat request with the user turn on the wire.
    const chatCalls = calls.filter((c) => c.url === "/api/chat");
    expect(chatCalls).toHaveLength(1);
    expect(
      (chatCalls[0].body as { messages: Array<{ content: string }> }).messages[0].content,
    ).toBe("hi");
  });

  it("ignores empty/whitespace input without starting a turn", () => {
    mockFetch({ "/api/chat": () => sseResponse([{ type: "text", text: "x" }]) });

    return importFresh<typeof import("~/lib/hooks/use-chat-stream")>(
      "~/lib/hooks/use-chat-stream",
    ).then(({ useChatStream }) =>
      importFresh<typeof import("~/lib/chat/sessions-store")>("~/lib/chat/sessions-store").then(
        (store) => {
          const session = store.createSession();
          const { result } = renderHook(() => useChatStream(session.id));
          act(() => {
            result.current.send("   ");
            result.current.send("");
          });
          expect(result.current.messages).toEqual([]);
          expect(result.current.status).toBe("ready");
        },
      ),
    );
  });

  it("does not leave an empty assistant placeholder when the stream produced no text", async () => {
    mockFetch({
      "/api/chat": () => sseResponse([]),
      "/api/title": () => jsonOk({ title: "Empty" }),
    });

    const store = await importFresh<typeof import("~/lib/chat/sessions-store")>(
      "~/lib/chat/sessions-store",
    );
    const { useChatStream } = await importFresh<typeof import("~/lib/hooks/use-chat-stream")>(
      "~/lib/hooks/use-chat-stream",
    );
    const session = store.createSession();

    const { result } = renderHook(() => useChatStream(session.id));
    act(() => {
      result.current.send("hi");
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));

    // The placeholder is dropped; only the user turn remains.
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].role).toBe("user");
  });
});

describe("useChatStream error path", () => {
  it("surfaces a non-ok response as status error + message", async () => {
    // An empty error body exercises readErrorMessage's status-fallback branch;
    // a body carrying {error} would win instead (covered implicitly below).
    mockFetch({
      "/api/chat": () =>
        ({
          ok: false,
          status: 429,
          body: null,
          json: async () => ({}),
        }) as unknown as Response,
    });

    const store = await importFresh<typeof import("~/lib/chat/sessions-store")>(
      "~/lib/chat/sessions-store",
    );
    const { useChatStream } = await importFresh<typeof import("~/lib/hooks/use-chat-stream")>(
      "~/lib/hooks/use-chat-stream",
    );
    const session = store.createSession();

    const { result } = renderHook(() => useChatStream(session.id));
    act(() => {
      result.current.send("hi");
    });

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toBe("Chat request failed with status 429.");
  });

  it("prefers a JSON error body over the status fallback", async () => {
    mockFetch({
      "/api/chat": () =>
        ({
          ok: false,
          status: 400,
          body: null,
          json: async () => ({ error: "id must be a uuid" }),
        }) as unknown as Response,
    });

    const store = await importFresh<typeof import("~/lib/chat/sessions-store")>(
      "~/lib/chat/sessions-store",
    );
    const { useChatStream } = await importFresh<typeof import("~/lib/hooks/use-chat-stream")>(
      "~/lib/hooks/use-chat-stream",
    );
    const session = store.createSession();

    const { result } = renderHook(() => useChatStream(session.id));
    act(() => {
      result.current.send("hi");
    });
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toBe("id must be a uuid");
  });

  it("surfaces a server-sent error frame as the error message", async () => {
    mockFetch({
      "/api/chat": () => sseResponse([{ type: "error", message: "upstream 502" }], { ok: true }),
    });

    const store = await importFresh<typeof import("~/lib/chat/sessions-store")>(
      "~/lib/chat/sessions-store",
    );
    const { useChatStream } = await importFresh<typeof import("~/lib/hooks/use-chat-stream")>(
      "~/lib/hooks/use-chat-stream",
    );
    const session = store.createSession();

    const { result } = renderHook(() => useChatStream(session.id));
    act(() => {
      result.current.send("hi");
    });
    await waitFor(() => expect(result.current.error).toBe("upstream 502"));
  });

  it("sets status error when fetch rejects", async () => {
    mockFetch({
      "/api/chat": async () => {
        throw new Error("network down");
      },
    });

    const store = await importFresh<typeof import("~/lib/chat/sessions-store")>(
      "~/lib/chat/sessions-store",
    );
    const { useChatStream } = await importFresh<typeof import("~/lib/hooks/use-chat-stream")>(
      "~/lib/hooks/use-chat-stream",
    );
    const session = store.createSession();

    const { result } = renderHook(() => useChatStream(session.id));
    act(() => {
      result.current.send("hi");
    });
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toBe("network down");
  });
});

describe("useChatStream stop", () => {
  it("aborts an in-flight turn and settles to ready", async () => {
    let releaseStream: () => void = () => {};
    mockFetch({
      "/api/chat": () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              // Never enqueue / close until released, so the turn stays in flight.
              releaseStream = () => {
                controller.enqueue(new TextEncoder().encode("data: [DONE]\n"));
                controller.close();
              };
            },
          }),
        ) as unknown as Response,
    });

    const store = await importFresh<typeof import("~/lib/chat/sessions-store")>(
      "~/lib/chat/sessions-store",
    );
    const { useChatStream } = await importFresh<typeof import("~/lib/hooks/use-chat-stream")>(
      "~/lib/hooks/use-chat-stream",
    );
    const session = store.createSession();

    const { result } = renderHook(() => useChatStream(session.id));
    act(() => {
      result.current.send("hi");
    });
    await waitFor(() => expect(result.current.status).toBe("streaming"));

    act(() => {
      result.current.stop();
    });
    expect(result.current.status).toBe("ready");

    // Releasing the held stream after abort is a no-op for the hook state.
    act(() => releaseStream());
    expect(result.current.status).toBe("ready");
  });
});

describe("useChatStream regenerate", () => {
  it("drops the trailing assistant reply and re-runs the last user turn", async () => {
    let n = 0;
    const { calls } = mockFetch({
      "/api/chat": () => {
        n += 1;
        return sseResponse([{ type: "text", text: n === 1 ? "first" : "second" }]);
      },
      "/api/title": () => jsonOk({ title: "T" }),
    });

    const store = await importFresh<typeof import("~/lib/chat/sessions-store")>(
      "~/lib/chat/sessions-store",
    );
    const { useChatStream } = await importFresh<typeof import("~/lib/hooks/use-chat-stream")>(
      "~/lib/hooks/use-chat-stream",
    );
    const session = store.createSession();

    const { result } = renderHook(() => useChatStream(session.id));
    act(() => {
      result.current.send("hi");
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.messages[1].content).toBe("first");

    act(() => {
      result.current.regenerate();
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[1].content).toBe("second");
    // Two chat calls total (send + regenerate), no extra.
    expect(calls.filter((c) => c.url === "/api/chat")).toHaveLength(2);
  });

  it("is a no-op while a turn is in flight", async () => {
    let release: () => void = () => {};
    mockFetch({
      "/api/chat": () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              release = () => {
                controller.enqueue(new TextEncoder().encode('data: {"type":"text","text":"ok"}\n'));
                controller.enqueue(new TextEncoder().encode("data: [DONE]\n"));
                controller.close();
              };
            },
          }),
        ) as unknown as Response,
    });

    const store = await importFresh<typeof import("~/lib/chat/sessions-store")>(
      "~/lib/chat/sessions-store",
    );
    const { useChatStream } = await importFresh<typeof import("~/lib/hooks/use-chat-stream")>(
      "~/lib/hooks/use-chat-stream",
    );
    const session = store.createSession();

    const { result } = renderHook(() => useChatStream(session.id));
    act(() => {
      result.current.send("hi");
    });
    await waitFor(() => expect(result.current.status).toBe("streaming"));

    // regenerate while busy is a no-op; the held stream is the original turn.
    act(() => {
      result.current.regenerate();
    });
    expect(result.current.status).toBe("streaming");

    act(() => release());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[1].content).toBe("ok");
  });
});

describe("useChatStream tool/usage/metadata/reasoning folding", () => {
  it("folds reasoning, tool steps, usage, breakdown, and tool-search metadata onto the assistant turn", async () => {
    mockFetch({
      "/api/chat": () =>
        sseResponse([
          { type: "reasoning", text: "thinking" },
          { type: "text", text: "answer" },
          {
            type: "tool_call",
            call: { name: "tool_search", arguments: { query: "weather" } },
          },
          {
            type: "tool_result",
            result: { name: "tool_search", ok: true, output: "found" },
          },
          { type: "usage", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
          {
            type: "breakdown",
            breakdown: {
              inputTokens: 10,
              categories: [{ id: "messages", tokens: 10, percentage: 100 }],
              tools: [],
            },
          },
          {
            type: "metadata",
            metadata: {
              mode: "search",
              availableToolCount: 200,
              sentToolCount: 3,
              catalogSchemaTokens: 29636,
              sentSchemaTokens: 390,
              baselineSchemaTokens: 29636,
              savedSchemaTokens: 29246,
              searchCount: 1,
              describeCount: 0,
              callCount: 0,
              trace: [],
            },
          },
        ]),
      "/api/title": () => jsonOk({ title: "T" }),
    });

    const store = await importFresh<typeof import("~/lib/chat/sessions-store")>(
      "~/lib/chat/sessions-store",
    );
    const { useChatStream } = await importFresh<typeof import("~/lib/hooks/use-chat-stream")>(
      "~/lib/hooks/use-chat-stream",
    );
    const session = store.createSession();

    const { result } = renderHook(() => useChatStream(session.id));
    act(() => {
      result.current.send("weather?");
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));

    const assistant = result.current.messages[1];
    expect(assistant.reasoning).toBe("thinking");
    expect(assistant.content).toBe("answer");
    expect(assistant.toolSteps).toHaveLength(1);
    expect(assistant.tokenUsage).toMatchObject({ inputTokens: 10, totalTokens: 15 });
    expect(assistant.tokenUsageBreakdown?.inputTokens).toBe(10);
    expect(assistant.toolSearch?.mode).toBe("search");
    expect(assistant.toolSearch?.savedSchemaTokens).toBe(29246);
    expect(assistant.toolSearch?.baselineSchemaTokens).toBe(29636);
    expect(assistant.toolSearch?.searchCount).toBe(1);
  });
});

describe("useChatStream titling", () => {
  it("fires /api/title exactly once after the first exchange and applies the result", async () => {
    const { calls } = mockFetch({
      "/api/chat": () => sseResponse([{ type: "text", text: "hi there" }]),
      "/api/title": () => jsonOk({ title: "A Greeting" }),
    });

    const store = await importFresh<typeof import("~/lib/chat/sessions-store")>(
      "~/lib/chat/sessions-store",
    );
    const { useChatStream } = await importFresh<typeof import("~/lib/hooks/use-chat-stream")>(
      "~/lib/hooks/use-chat-stream",
    );
    const session = store.createSession();
    const sessionId = session.id;

    const { result } = renderHook(() => useChatStream(sessionId));
    act(() => {
      result.current.send("hello");
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));

    // The titler fires post-commit; give it a tick.
    await waitFor(() => {
      expect(calls.some((c) => c.url === "/api/title")).toBe(true);
    });
    expect(store.getSession(sessionId)?.title).toBe("A Greeting");

    // Sending a second turn must NOT re-title.
    act(() => {
      result.current.send("again");
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    const titleCallsBefore = calls.filter((c) => c.url === "/api/title").length;
    await new Promise((r) => setTimeout(r, 50));
    const titleCallsAfter = calls.filter((c) => c.url === "/api/title").length;
    expect(titleCallsAfter).toBe(titleCallsBefore);
  });
});

describe("useChatStream skill activation on the wire", () => {
  it("prepends the skill block to the user turn on the wire only, not into content", async () => {
    const skill: Skill = {
      id: "sk1",
      name: "pig-latin",
      description: "speak pig latin",
      body: "Respond in pig latin.",
      references: [],
      isEnabled: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const { calls } = mockFetch({
      "/api/chat": () => sseResponse([{ type: "text", text: "ok" }]),
      "/api/title": () => jsonOk({ title: "T" }),
    });

    const store = await importFresh<typeof import("~/lib/chat/sessions-store")>(
      "~/lib/chat/sessions-store",
    );
    const { useChatStream } = await importFresh<typeof import("~/lib/hooks/use-chat-stream")>(
      "~/lib/hooks/use-chat-stream",
    );
    const session = store.createSession();

    const { result } = renderHook(() => useChatStream(session.id, [skill]));
    act(() => {
      result.current.send("hello world", { skill });
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));

    // Wire payload carries the injected block prefixed to the user content...
    const chatBody = calls.find((c) => c.url === "/api/chat")?.body as {
      messages: Array<{ content: string }>;
    };
    expect(chatBody.messages.at(-1)?.content).toContain("skill_content");
    expect(chatBody.messages.at(-1)?.content).toContain("hello world");

    // ...but the rendered/persisted user content is the raw text only.
    const userMsg = result.current.messages[0] as ChatMessage;
    expect(userMsg.content).toBe("hello world");
    expect(userMsg.activatedSkill).toBe("pig-latin");
  });
});
