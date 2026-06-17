import { createFileRoute } from "@tanstack/react-router";

import { toolRegistry } from "~/lib/server/tools/registry";
import { catalogSchemaTokens, catalogToolCount } from "~/lib/server/tools/tool-search";

export const Route = createFileRoute("/api/tools/")({
  server: {
    handlers: {
      GET: async () => {
        const services = new Map<string, number>();

        for (const spec of toolRegistry.specs) {
          services.set(spec.service, (services.get(spec.service) ?? 0) + 1);
        }

        return Response.json({
          count: catalogToolCount,
          catalogSchemaTokens,
          services: Object.fromEntries(
            Array.from(services.entries()).sort(([a], [b]) => a.localeCompare(b)),
          ),
        });
      },
    },
  },
});
