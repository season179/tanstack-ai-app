import { createFileRoute } from "@tanstack/react-router";

import { executeToolDescribe, type ToolSearchTraceEvent } from "~/lib/server/tools/tool-search";

export const Route = createFileRoute("/api/tools/describe")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const name = url.searchParams.get("name")?.trim() ?? "";

        if (!name) {
          return Response.json({ error: "Query parameter 'name' is required." }, { status: 400 });
        }

        const trace: ToolSearchTraceEvent[] = [];
        const result = executeToolDescribe({ name }, trace);

        if (!result.found) {
          return Response.json({ error: result.error, name: result.name, trace }, { status: 404 });
        }

        return Response.json({ result, trace });
      },
    },
  },
});
