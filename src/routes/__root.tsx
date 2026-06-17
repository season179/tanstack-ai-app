/// <reference types="vite/client" />
import { createRootRouteWithContext, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";

import { AppShell } from "~/components/app-shell";
import appCss from "~/styles/app.css?url";

export const Route = createRootRouteWithContext()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "TanStack AI App" },
      {
        name: "description",
        content: "A streaming chatbot built with TanStack Start, React, and OpenRouter.",
      },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: RootDocument,
  component: RootComponent,
});

function RootComponent() {
  return (
    <AppShell>
      <Outlet />
      <TanStackRouterDevtools position="bottom-right" />
    </AppShell>
  );
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {/* Browser extensions (e.g. Grammarly) inject attributes onto <body>
            before hydration; suppress the resulting attribute mismatch here. */}
        <div suppressHydrationWarning>{children}</div>
        <Scripts />
      </body>
    </html>
  );
}
