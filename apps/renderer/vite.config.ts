import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

const root = __dirname;

export default defineConfig({
  root,
  base: "./",
  plugins: [react()],
  resolve: {
    alias: {
      // Use package sources directly so the UI needs no build step before running.
      "@zcodex/contracts": path.resolve(root, "../../packages/contracts/src/index.ts"),
      "@zcodex/codex-protocol": path.resolve(root, "../../packages/codex-protocol/src/index.ts"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "chrome120",
  },
  clearScreen: false,
});
