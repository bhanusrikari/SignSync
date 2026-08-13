import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

// Builds the content script as a single self-contained IIFE. MV3 content
// scripts are loaded as classic scripts, so they cannot use ES `import`.
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
    cssCodeSplit: false,
    rollupOptions: {
      input: {
        content: resolve(__dirname, "src/content/content.tsx"),
      },
      output: {
        entryFileNames: "content.js",
        assetFileNames: "content.[ext]",
        format: "iife",
      },
    },
  },
});
