// @vitest-environment jsdom
//
// DOM-environment hook tests for useModels (lazy catalog fetch + localStorage
// model selection persistence). The hook reads window.localStorage on mount and
// drives a lazy fetch('/api/models') on ensureLoaded(), so coverage needs jsdom
// (localStorage + a mockable global fetch). renderHook drives the React
// effect/sate lifecycle so the mount-restore effect and the ensureLoaded
// promise chain both commit. This establishes the React Testing Library
// renderHook harness the iteration-52 notes flagged as the remaining coverage
// frontier (the React hooks layer).
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useModels } from "~/lib/hooks/use-models";

type ModelsResponse = {
  models: Array<{ id: string; name: string; contextLength: number | null }>;
  defaultModel: string | null;
};

const MODEL_STORAGE_KEY = "chat:selected-model";

function makeResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body,
  } as unknown as Response;
}

function jsonModels(models: ModelsResponse["models"], defaultModel: string | null): Response {
  return makeResponse({ models, defaultModel });
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useModels initial state", () => {
  it("starts empty with no selection and not loading", () => {
    const { result } = renderHook(() => useModels());
    expect(result.current.models).toEqual([]);
    expect(result.current.defaultModel).toBeNull();
    expect(result.current.selectedModel).toBeNull();
    expect(result.current.loading).toBe(false);
  });
});

describe("useModels localStorage selection restore", () => {
  it("restores the stored model id after the mount effect commits", async () => {
    window.localStorage.setItem(MODEL_STORAGE_KEY, "openai/gpt-4o");
    const { result } = renderHook(() => useModels());
    // The restore happens in useEffect, so it lands after the first render.
    await waitFor(() => {
      expect(result.current.selectedModel).toBe("openai/gpt-4o");
    });
  });

  it("stays null when nothing is stored", async () => {
    const { result } = renderHook(() => useModels());
    await waitFor(() => {
      expect(result.current.selectedModel).toBeNull();
    });
  });

  it("stays null and does not throw when localStorage access throws", async () => {
    const getter = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    const { result } = renderHook(() => useModels());
    await waitFor(() => {
      expect(result.current.selectedModel).toBeNull();
    });
    getter.mockRestore();
  });
});

describe("useModels setSelectedModel persistence", () => {
  it("mirrors a pick into localStorage and state", async () => {
    const { result } = renderHook(() => useModels());
    await waitFor(() => expect(result.current.selectedModel).toBeNull());

    act(() => {
      result.current.setSelectedModel("anthropic/claude-3.5");
    });
    expect(result.current.selectedModel).toBe("anthropic/claude-3.5");
    expect(window.localStorage.getItem(MODEL_STORAGE_KEY)).toBe("anthropic/claude-3.5");
  });

  it("removes the key when set to null", async () => {
    window.localStorage.setItem(MODEL_STORAGE_KEY, "openai/gpt-4o");
    const { result } = renderHook(() => useModels());
    await waitFor(() => expect(result.current.selectedModel).toBe("openai/gpt-4o"));

    act(() => {
      result.current.setSelectedModel(null);
    });
    expect(result.current.selectedModel).toBeNull();
    expect(window.localStorage.getItem(MODEL_STORAGE_KEY)).toBeNull();
  });

  it("still updates in-memory selection when localStorage write throws", async () => {
    const setter = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    const { result } = renderHook(() => useModels());
    await waitFor(() => expect(result.current.selectedModel).toBeNull());

    act(() => {
      result.current.setSelectedModel("google/gemini-pro");
    });
    expect(result.current.selectedModel).toBe("google/gemini-pro");
    setter.mockRestore();
  });

  it("does not throw when removing from an unavailable localStorage", async () => {
    const remover = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    const { result } = renderHook(() => useModels());
    await waitFor(() => expect(result.current.selectedModel).toBeNull());

    expect(() => {
      act(() => {
        result.current.setSelectedModel(null);
      });
    }).not.toThrow();
    expect(result.current.selectedModel).toBeNull();
    remover.mockRestore();
  });
});

describe("useModels ensureLoaded lazy fetch", () => {
  it("populates models + defaultModel from a successful response", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonModels(
        [
          { id: "openai/gpt-4o", name: "GPT-4o", contextLength: 128000 },
          { id: "meta/llama-3", name: "Llama 3", contextLength: 8000 },
        ],
        "openai/gpt-4o",
      ),
    );

    const { result } = renderHook(() => useModels());
    await waitFor(() => expect(result.current.selectedModel).toBeNull());

    act(() => {
      result.current.ensureLoaded();
    });
    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.models).toHaveLength(2);
    expect(result.current.models[0]).toMatchObject({ id: "openai/gpt-4o", name: "GPT-4o" });
    expect(result.current.defaultModel).toBe("openai/gpt-4o");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/models");
  });

  it("is idempotent: repeated calls issue a single fetch", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonModels([], null));

    const { result } = renderHook(() => useModels());
    await waitFor(() => expect(result.current.selectedModel).toBeNull());

    act(() => {
      result.current.ensureLoaded();
      result.current.ensureLoaded();
      result.current.ensureLoaded();
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("leaves models empty on a non-ok response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(makeResponse({ error: "no key" }, false));

    const { result } = renderHook(() => useModels());
    await waitFor(() => expect(result.current.selectedModel).toBeNull());

    act(() => {
      result.current.ensureLoaded();
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.models).toEqual([]);
    expect(result.current.defaultModel).toBeNull();
  });

  it("allows a retry after a fetch rejection by resetting the requested guard", async () => {
    let call = 0;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      call += 1;
      if (call === 1) {
        throw new Error("network down");
      }
      return jsonModels(
        [{ id: "openai/gpt-4o", name: "GPT-4o", contextLength: null }],
        "openai/gpt-4o",
      );
    });

    const { result } = renderHook(() => useModels());
    await waitFor(() => expect(result.current.selectedModel).toBeNull());

    act(() => {
      result.current.ensureLoaded();
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.models).toEqual([]);

    // The failed fetch resets `requested`, so a second ensureLoaded retries.
    act(() => {
      result.current.ensureLoaded();
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.models).toHaveLength(1);
    expect(result.current.defaultModel).toBe("openai/gpt-4o");
  });

  it("flips loading true while in flight and back to false when it settles", async () => {
    let resolveResponse: (value: Response) => void = () => {};
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveResponse = resolve;
        }),
    );

    const { result } = renderHook(() => useModels());
    await waitFor(() => expect(result.current.selectedModel).toBeNull());

    act(() => {
      result.current.ensureLoaded();
    });
    expect(result.current.loading).toBe(true);

    await act(async () => {
      resolveResponse(jsonModels([], null));
    });
    expect(result.current.loading).toBe(false);
  });
});
