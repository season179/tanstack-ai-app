import { createFileRoute } from "@tanstack/react-router";

import { generateSessionTitle } from "~/lib/server/title";

/**
 * Generates a short session title from a first user+assistant exchange via a
 * single non-streaming OpenRouter call (no AI SDK). Used by the client after
 * the first chat turn completes to name the session, with a client-side
 * first-message fallback when this route returns null or errors.
 */
export const Route = createFileRoute("/api/title")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
        }

        const firstUserText = (body as { firstUserText?: unknown })?.firstUserText;
        const firstAssistantText = (body as { firstAssistantText?: unknown })?.firstAssistantText;
        if (typeof firstUserText !== "string" || typeof firstAssistantText !== "string") {
          return Response.json(
            { error: "Request body must include firstUserText and firstAssistantText strings." },
            { status: 400 },
          );
        }

        try {
          const title = await generateSessionTitle({ firstUserText, firstAssistantText });
          return Response.json({ title });
        } catch (error) {
          console.error("Title route failed", error);
          // Fail soft: a null title lets the client fall back to a first-message
          // title rather than surfacing a 500 to the chat UI.
          return Response.json({ title: null });
        }
      },
    },
  },
});
