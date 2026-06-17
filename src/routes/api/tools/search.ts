import { createFileRoute } from "@tanstack/react-router";

import {
  catalogSchemaTokens,
  executeToolSearch,
  type ToolSearchTraceEvent,
} from "~/lib/server/tools/tool-search";

export const Route = createFileRoute("/api/tools/search")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const query = url.searchParams.get("q")?.trim() ?? "";

        if (!query) {
          return Response.json({ error: "Query parameter 'q' is required." }, { status: 400 });
        }

        const rawLimit = url.searchParams.get("limit");
        const limit = rawLimit == null ? undefined : Number.parseInt(rawLimit, 10);

        const trace: ToolSearchTraceEvent[] = [];
        const result = executeToolSearch({ query, limit }, trace);

        return Response.json({
          query: result.query,
          limit: result.limit,
          totalAvailable: result.totalAvailable,
          catalogSchemaTokens,
          matches: result.matches,
          trace,
        });
      },
    },
  },
});
