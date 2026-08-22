import { defineConfig } from "vitest/config";
import { resolve } from "path";

// Minimal config for the pure-function unit tests under src/. Kept separate
// from the vite.*.config.ts build configs (which are extension build
// targets, not test configs) so it can never interfere with them. No
// plugins needed and DOM/Chrome APIs are out of scope, so "node" is
// sufficient -- but the "@/" alias (same mapping as every vite.*.config.ts)
// IS needed: source files use it for cross-directory imports (e.g.
// services/* importing from shared/*), same as the rest of the codebase.
export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
