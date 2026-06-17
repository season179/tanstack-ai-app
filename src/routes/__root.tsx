/// <reference types="vite/client" />
import { createRootRouteWithContext, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";

import { AppShell } from "~/components/app-shell";
import { THEME_STORAGE_KEY, ThemeProvider } from "~/lib/hooks/use-theme";
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
    <ThemeProvider>
      <AppShell>
        <Outlet />
        <TanStackRouterDevtools position="bottom-right" />
      </AppShell>
    </ThemeProvider>
  );
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
        {/* No-flash theme script: runs before paint to set the `.dark` class
            on <html> from the stored preference (or the OS preference when
            unset/system), so the first frame is already the right theme.
            Kept inline + framework-free to avoid a light/dark flash. */}
        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: no-flash theme script; the body is a static constant (no user input), required to set the .dark class before paint.
          dangerouslySetInnerHTML={{
            __html: `try{var k=${JSON.stringify(THEME_STORAGE_KEY)},t=localStorage.getItem(k);if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}if(t==='dark'){document.documentElement.classList.add('dark');}}catch(e){}`,
          }}
        />
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
