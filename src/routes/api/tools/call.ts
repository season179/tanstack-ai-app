import { createFileRoute } from "@tanstack/react-router";

import { executeToolCall, type ToolSearchTraceEvent } from "~/lib/server/tools/tool-search";

type CallRequestBody = {
  name?: unknown;
  arguments?: unknown;
};

export const Route = createFileRoute("/api/tools/call")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: CallRequestBody;
        try {
          body = (await request.json()) as CallRequestBody;
        } catch {
          return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
        }

        const name = typeof body.name === "string" ? body.name.trim() : "";
        const args =
          typeof body.arguments === "object" &&
          body.arguments !== null &&
          !Array.isArray(body.arguments)
            ? (body.arguments as Record<string, unknown>)
            : {};

        if (!name) {
          return Response.json({ error: "Field 'name' is required." }, { status: 400 });
        }

        const trace: ToolSearchTraceEvent[] = [];
        const result = await executeToolCall({ name, arguments: args }, trace);

        if (!result.found) {
          return Response.json({ error: result.error, name: result.name, trace }, { status: 404 });
        }

        return Response.json({ result, trace });
      },
    },
  },
});
