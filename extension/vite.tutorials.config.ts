import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

// Builds the Learn Sign Language tutorial hub (Phase 10 Part 6): a
// dedicated, visible tab, same shape as vite.record.config.ts/
// vite.validate.config.ts -- no camera/offscreen concerns here either, just
// a content page.
export default defineConfig({
  plugins: [react()],
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
        tutorials: resolve(__dirname, "tutorials.html"),
      },
    },
  },
});
