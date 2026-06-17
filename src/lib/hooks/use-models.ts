import { useCallback, useEffect, useRef, useState } from "react";

import type { ModelsResponse } from "~/lib/types";

/** Persists the composer's model choice across reloads (per browser, MVP). */
const MODEL_STORAGE_KEY = "chat:selected-model";

export type UseModels = {
  models: ModelsResponse["models"];
  defaultModel: string | null;
  selectedModel: string | null;
  loading: boolean;
  setSelectedModel: (modelId: string | null) => void;
  /** Lazy-fetch the catalog on first need; safe to call repeatedly. */
  ensureLoaded: () => void;
};

/**
 * Loads the OpenRouter model catalog lazily and mirrors the user's pick into
 * localStorage so it survives a reload. Fails soft: a missing key or upstream
 * error leaves the list empty and the picker falls back to the default.
 */
export function useModels(): UseModels {
  const [models, setModels] = useState<ModelsResponse["models"]>([]);
  const [defaultModel, setDefaultModel] = useState<string | null>(null);
  const [selectedModel, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const requested = useRef(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(MODEL_STORAGE_KEY);
      if (stored) {
        setSelected(stored);
      }
    } catch {
      // localStorage can be unavailable (private mode); selection stays null.
    }
  }, []);

  const setSelectedModel = useCallback((modelId: string | null) => {
    setSelected(modelId);
    try {
      if (modelId) {
        window.localStorage.setItem(MODEL_STORAGE_KEY, modelId);
      } else {
        window.localStorage.removeItem(MODEL_STORAGE_KEY);
      }
    } catch {
      // Best-effort persistence; in-memory selection still applies.
    }
  }, []);

  const ensureLoaded = useCallback(() => {
    if (requested.current) {
      return;
    }
    requested.current = true;
    setLoading(true);
    fetch("/api/models")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: ModelsResponse | null) => {
        if (!data) {
          return;
        }
        setModels(data.models);
        setDefaultModel(data.defaultModel);
      })
      .catch(() => {
        // Best-effort: allow a later open to retry after a transient failure.
        requested.current = false;
      })
      .finally(() => setLoading(false));
  }, []);

  return {
    models,
    defaultModel,
    selectedModel,
    loading,
    setSelectedModel,
    ensureLoaded,
  };
}
