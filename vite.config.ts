import { defineConfig, loadEnv } from "vite";
import { createGoogleAuth } from "./server/google-auth.mjs";
import react from "@vitejs/plugin-react";
import { pdfDecoderAssets } from "./scripts/pdf-assets-dev";
export default defineConfig({
  plugins: [pdfDecoderAssets(), react(), {
    name: 'minotes-google-session',
    configureServer(server) {
      const env = { ...loadEnv(server.config.mode, process.cwd(), ''), ...process.env };
      server.middlewares.use(createGoogleAuth(env));
    },
  }],
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
    headers: { "Cross-Origin-Opener-Policy": "same-origin-allow-popups", "Referrer-Policy": "no-referrer-when-downgrade" },
    watch: { ignored: ["**/src-tauri/**"] },
  },
  clearScreen: false,
});
