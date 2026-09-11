import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("tiptap") || id.includes("prosemirror"))
              return "editor-engine";
            if (id.includes("konva")) return "drawing-engine";
            if (id.includes("framer-motion") || id.includes("motion-"))
              return "motion";
          }
        },
      },
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  clearScreen: false,
});
