import { createFileRoute } from "@tanstack/react-router";

import { fetchAccountModels } from "~/lib/server/openrouter";

export const Route = createFileRoute("/api/models")({
  server: {
    handlers: {
      GET: async () => {
        const apiKey = process.env.OPENROUTER_API_KEY?.trim();
        const defaultModel = process.env.OPENROUTER_DEFAULT_MODEL?.trim() || null;

        if (!apiKey) {
          return Response.json({ models: [], defaultModel });
        }

        try {
          const models = await fetchAccountModels(apiKey);
          return Response.json({ models, defaultModel });
        } catch (error) {
          console.error("Listing OpenRouter models failed", error);
          return Response.json({ models: [], defaultModel });
        }
      },
    },
  },
});
