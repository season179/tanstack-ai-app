import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Standalone Vitest config (NOT extending vite.config.ts). The dev/build
// pipeline wires nitro + tanstackStart plugins that aren't meaningful under the
// test runner (and would try to spin up server entries), so this file keeps the
// test environment minimal: the ~/* path alias from tsconfig + a node
// environment so `process.env` and Node globals are available to the pure
// domain modules under test (tool-search, sse, scheduler, etc.). Test files
// live next to their sources as *.test.ts so co-location makes coverage gaps
// obvious.
export default defineConfig({
  resolve: {
    alias: {
      "~": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
