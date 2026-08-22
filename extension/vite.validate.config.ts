import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

// Builds the "Validate My Gestures" page: reads the user's already-saved
// personalized gestures straight from chrome.storage.local (via the
// existing services/personalizedGestures.ts) and runs
// ai/personalizedGestureValidation.ts against them. Same shape as
// vite.record.config.ts (React, own dedicated visible tab) -- no DevTools,
// no export step required from the user.
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
        validate: resolve(__dirname, "validate.html"),
      },
    },
  },
});
