import { defineConfig } from "vite";
import { resolve } from "path";

// Builds the offscreen document used by the camera-access spike (gesture-
// recognition plan, Step 1). Plain page build, same shape as popup.html —
// no React needed for this spike.
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
        offscreen: resolve(__dirname, "offscreen.html"),
      },
    },
  },
});
