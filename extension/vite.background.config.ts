import { defineConfig } from "vite";
import { resolve } from "path";

// Builds the background service worker as a single ES module file (MV3 service
// workers support "type": "module", so no bundling into a classic IIFE is needed).
export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: false,
    rollupOptions: {
      input: {
        background: resolve(__dirname, "src/background/service-worker.ts"),
      },
      output: {
        entryFileNames: "background.js",
        format: "es",
      },
    },
  },
});
