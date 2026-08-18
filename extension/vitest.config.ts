import { defineConfig } from "vitest/config";

// Minimal config for the pure-function unit tests under src/ai/. Kept
// separate from the vite.*.config.ts build configs (which are extension
// build targets, not test configs) so it can never interfere with them.
// No plugins/aliases needed: the files under test use only relative
// imports and have zero DOM/Chrome dependency, so "node" is sufficient.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
