/** Shared client/server domain types. Kept free of server-only imports so it can
 *  be safely bundled into the browser. */

/** Trimmed model shape the picker renders; mirrors the server's catalog entry. */
export type OpenRouterModelSummary = {
  id: string;
  name: string;
  contextLength: number | null;
};

export type ModelsResponse = {
  models: OpenRouterModelSummary[];
  defaultModel: string | null;
};
