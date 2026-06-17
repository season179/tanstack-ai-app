// @vitest-environment jsdom
//
// DOM-environment tests for the scheduled-task background executor
// (run-instruction.ts). This is the last side-effect module driving a
// user-visible feature (scheduled fires → real /api/chat turn → home-session
// transcript) that had no coverage (iteration 46 noted it as a natural
// frontier: "untested modules with side effects ... that require network/
// mocking rather than pure-function tests"). The executor touches localStorage
// (sessions-store read/write + tasks-store completeRun) and the network
// (fetch /api/chat + the shared SSE reader), so the harness mocks global
// `fetch` to return a scripted SSE Response and lets the real stores run,
// then asserts on the settled run + the persisted transcript.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const importExecutor = async () => import("~/lib/tasks/run-instruction");
const importTasks = async () => import("~/lib/tasks/tasks-store");
const importSessions = async () => import("~/lib/chat/sessions-store");

/** Build a ReadableStream<Uint8Array> that emits the given frames as the
 *  app's self-owned SSE protocol (one `data: {...}` line per frame + [DONE]). */
function sseBody(frames: object[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const lines = frames.map((frame) => `data: ${JSON.stringify(frame)}`).join("\n");
  const payload = `${lines}\ndata: [DONE]\n`;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(payload));
      controller.close();
    },
  });
}

/** A scripted SSE Response for the happy paths (status 200 + stream body). */
function okResponse(frames: object[]): Response {
  return new Response(sseBody(frames), { status: 200 });
}

/** A failed Response with an optional JSON `{ error }` body (the route's error
 *  contract). When `errorBody` is omitted, the body is empty so the executor
 *  falls back to the status text. */
function errorResponse(status: number, errorBody?: { error: string }): Response {
  return new Response(errorBody ? JSON.stringify(errorBody) : "", {
    status,
    headers: {
      "Content-Type": errorBody ? "application/json" : "text/plain",
    },
  });
}

describe("run-instruction (DOM)", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** Create a task (which mints + pins a home chat session) and an unsettled
   *  run for it, returning both so a test can drive executeScheduledRun. */
  async function setup(instruction = "Summarize the weather") {
    const { createTask, ensureRun } = await importTasks();
    const task = createTask({
      title: "T",
      scheduleType: "once",
      instruction,
      runAt: "2024-06-01T00:05:00.000Z",
    });
    const run = ensureRun(task, "2024-06-01T00:05:00.000Z");
    return { task, run };
  }

  /** Find the settled version of a run in the store (or undefined). */
  async function findRun(runId: string) {
    const { getRunsSnapshot } = await importTasks();
    return getRunsSnapshot().find((r) => r.id === runId);
  }

  // --- happy path ----------------------------------------------------------

  it("streams text, settles completed with the reply as the verdict, and appends user+assistant(origin=scheduled) to the transcript", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse([
        { type: "text", text: "Hello " },
        { type: "text", text: "world" },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { executeScheduledRun } = await importExecutor();
    const { readMessages } = await importSessions();
    const { task, run } = await setup();

    await executeScheduledRun(run, task);

    const settled = await findRun(run.id);
    expect(settled?.status).toBe("completed");
    expect(settled?.output).toEqual({ statusUpdate: "Hello world" });
    expect(settled?.error).toBeNull();
    expect(settled?.completedAt).not.toBeNull();

    const transcript = readMessages(task.homeSessionId ?? "");
    expect(transcript).toHaveLength(2);
    expect(transcript[0]).toMatchObject({
      role: "user",
      content: "Summarize the weather",
    });
    expect(transcript[1]).toMatchObject({
      role: "assistant",
      content: "Hello world",
      origin: "scheduled",
    });
  });

  it("sends the wire payload as { id: homeSessionId, messages: [history..., { user, instruction }] }", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse([{ type: "text", text: "ok" }]));
    vi.stubGlobal("fetch", fetchMock);

    const { executeScheduledRun } = await importExecutor();
    const { task, run } = await setup("Do the thing");

    await executeScheduledRun(run, task);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.id).toBe(task.homeSessionId);
    expect(body.messages.at(-1)).toEqual({ role: "user", content: "Do the thing" });
    // Home session starts empty, so the only wire message is this fire's user turn.
    expect(body.messages).toHaveLength(1);
  });

  it("threads prior transcript turns (user/assistant) as history before the new instruction", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse([{ type: "text", text: "ok" }]));
    vi.stubGlobal("fetch", fetchMock);

    const { executeScheduledRun } = await importExecutor();
    const { writeMessages } = await importSessions();
    const { task, run } = await setup("Next turn");

    // Seed the home transcript with a prior exchange.
    writeMessages(task.homeSessionId ?? "", [
      { id: "u1", role: "user", content: "first" },
      { id: "a1", role: "assistant", content: "reply" },
    ]);

    await executeScheduledRun(run, task);

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.messages.map((m: { content: string }) => m.content)).toEqual([
      "first",
      "reply",
      "Next turn",
    ]);
  });

  // --- multi-frame folding -------------------------------------------------

  it("folds reasoning / tool_call / tool_result / usage / breakdown / metadata frames onto the assistant turn", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse([
        { type: "reasoning", text: "thinking…" },
        { type: "text", text: "answer" },
        {
          type: "tool_call",
          call: { name: "tool_search", arguments: { query: "weather" } },
        },
        {
          type: "tool_result",
          result: { name: "tool_search", ok: true, output: '{"matches":[]}' },
        },
        {
          type: "usage",
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        },
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
            catalogSchemaTokens: 1000,
            sentSchemaTokens: 100,
            baselineSchemaTokens: 1000,
            savedSchemaTokens: 900,
            searchCount: 1,
            describeCount: 0,
            callCount: 0,
          },
        },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { executeScheduledRun } = await importExecutor();
    const { readMessages } = await importSessions();
    const { task, run } = await setup();

    await executeScheduledRun(run, task);

    const transcript = readMessages(task.homeSessionId ?? "");
    const assistant = transcript[1];
    expect(assistant.content).toBe("answer");
    expect(assistant.reasoning).toBe("thinking…");
    // parseUsageFrame defaults reasoningTokens/cachedInputTokens to 0 when absent on the wire.
    expect(assistant.tokenUsage).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      reasoningTokens: 0,
      cachedInputTokens: 0,
    });
    expect(assistant.tokenUsageBreakdown?.inputTokens).toBe(10);
    expect(assistant.toolSearch?.mode).toBe("search");
    expect(assistant.toolSearch?.availableToolCount).toBe(200);
    expect(assistant.toolSearch?.searchCount).toBe(1);
    // The tool_call + tool_result pair becomes a single step (call appends a
    // running step, result completes the most-recent running step by name).
    expect(assistant.toolSteps).toHaveLength(1);
    expect(assistant.toolSteps?.[0]).toMatchObject({
      name: "tool_search",
      status: "ok",
    });
  });

  it("uses 'Completed.' as the verdict when the streamed reply is blank/whitespace", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse([{ type: "text", text: "   " }]));
    vi.stubGlobal("fetch", fetchMock);

    const { executeScheduledRun } = await importExecutor();
    const { task, run } = await setup();

    await executeScheduledRun(run, task);

    const settled = await findRun(run.id);
    expect(settled?.status).toBe("completed");
    expect(settled?.output).toEqual({ statusUpdate: "Completed." });
  });

  // --- failure modes -------------------------------------------------------

  it("fails with a clear error when the task has no instruction", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { executeScheduledRun } = await importExecutor();
    const { task, run } = await setup("  "); // whitespace-only instruction

    await executeScheduledRun(run, {
      ...task,
      payload: { kind: "instruction", instruction: "   " },
    });

    const settled = await findRun(run.id);
    expect(settled?.status).toBe("failed");
    expect(settled?.error).toMatch(/no instruction/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails when the task has no home session to write the transcript to", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { executeScheduledRun } = await importExecutor();
    const { task, run } = await setup();

    // Strip the home session link (defensive path for legacy tasks).
    await executeScheduledRun(run, { ...task, homeSessionId: null });

    const settled = await findRun(run.id);
    expect(settled?.status).toBe("failed");
    expect(settled?.error).toMatch(/no home session/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails with the network error message when fetch rejects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network down")));

    const { executeScheduledRun } = await importExecutor();
    const { task, run } = await setup();

    await executeScheduledRun(run, task);

    const settled = await findRun(run.id);
    expect(settled?.status).toBe("failed");
    expect(settled?.error).toBe("Network down");
  });

  it("fails with the JSON error body when the response is not ok and carries { error }", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(errorResponse(500, { error: "Upstream boom" })),
    );

    const { executeScheduledRun } = await importExecutor();
    const { task, run } = await setup();

    await executeScheduledRun(run, task);

    const settled = await findRun(run.id);
    expect(settled?.status).toBe("failed");
    expect(settled?.error).toBe("Upstream boom");
  });

  it("fails with the status text when the response is not ok and the body is not JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(errorResponse(503)));

    const { executeScheduledRun } = await importExecutor();
    const { task, run } = await setup();

    await executeScheduledRun(run, task);

    const settled = await findRun(run.id);
    expect(settled?.status).toBe("failed");
    expect(settled?.error).toMatch(/503/);
  });

  it("fails with the frame message when the stream emits an error frame", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(okResponse([{ type: "error", message: "Provider melted" }])),
    );

    const { executeScheduledRun } = await importExecutor();
    const { readMessages } = await importSessions();
    const { task, run } = await setup();

    await executeScheduledRun(run, task);

    const settled = await findRun(run.id);
    expect(settled?.status).toBe("failed");
    expect(settled?.error).toBe("Provider melted");
    // No transcript append on a failed stream.
    expect(readMessages(task.homeSessionId ?? "")).toEqual([]);
  });

  // --- concurrency / idempotency ------------------------------------------

  it("is idempotent per run id: a concurrent second call no-ops (fetch fires once)", async () => {
    let resolveStream: (value: Response) => void = () => {};
    const fetchMock = vi.fn().mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveStream = resolve;
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { executeScheduledRun } = await importExecutor();
    const { task, run } = await setup();

    // Fire twice without awaiting; the second must see the run as in-flight.
    const first = executeScheduledRun(run, task);
    const second = executeScheduledRun(run, task);
    // Allow the second to settle as a no-op.
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Release the held stream so the first call can finish and the test exits cleanly.
    resolveStream(okResponse([{ type: "text", text: "done" }]));
    await Promise.all([first, second]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const settled = await findRun(run.id);
    expect(settled?.status).toBe("completed");
  });

  it("runs two distinct runs independently (separate fetches + transcripts)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okResponse([{ type: "text", text: "one" }]))
      .mockResolvedValueOnce(okResponse([{ type: "text", text: "two" }]));
    vi.stubGlobal("fetch", fetchMock);

    const { executeScheduledRun } = await importExecutor();
    const { ensureRun } = await importTasks();
    const { readMessages } = await importSessions();
    const { task, run: run1 } = await setup("First");
    const run2 = ensureRun(task, "2024-06-01T00:06:00.000Z");

    await executeScheduledRun(run1, task);
    await executeScheduledRun(run2, task);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const transcript = readMessages(task.homeSessionId ?? "");
    // Both fires appended their user+assistant turns to the same transcript.
    expect(transcript).toHaveLength(4);
    expect(transcript.map((m) => m.content)).toEqual(["First", "one", "First", "two"]);
  });

  // --- side effects --------------------------------------------------------

  it("touches the home session so a fresh scheduled reply floats to the top of the sidebar", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse([{ type: "text", text: "hi" }])));

    const { executeScheduledRun } = await importExecutor();
    const { getSession } = await importSessions();
    const { task, run } = await setup();

    const before = getSession(task.homeSessionId ?? "");
    // Wait a tick so the touch's nowIso() is observably newer (ms granularity).
    await new Promise((resolve) => setTimeout(resolve, 5));
    await executeScheduledRun(run, task);

    const after = getSession(task.homeSessionId ?? "");
    expect(after?.updatedAt).not.toBe(before?.updatedAt);
  });
});
