import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

// Builds the personalized-gesture recording page: a dedicated, visible tab
// (same reasoning as vite.permission.config.ts -- an offscreen document
// can't host a live camera preview or a capture UI). Uses React like
// vite.config.ts's popup build, since this page's form + preview + capture
// UI is materially richer than permission.html/offscreen.html's plain DOM.
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
        record: resolve(__dirname, "record.html"),
      },
    },
  },
});
