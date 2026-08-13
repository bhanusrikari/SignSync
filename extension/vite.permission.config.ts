import { defineConfig } from "vite";
import { resolve } from "path";

// Builds the camera-permission tab used by the gesture-recognition camera
// foundation. getUserMedia can't reliably prompt from an invisible offscreen
// document, so this visible, user-interactive tab establishes the grant
// first (see gesture-recognition plan follow-up). Plain page build, same
// shape as offscreen.html -- no React needed.
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
        permission: resolve(__dirname, "permission.html"),
      },
    },
  },
});
