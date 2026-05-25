import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const dashboardDir = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = path.resolve(dashboardDir, "..");

export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: {
      react: path.join(repoRoot, "node_modules/react"),
      "react-dom": path.join(repoRoot, "node_modules/react-dom"),
    },
  },
  server: {
    fs: {
      allow: [repoRoot],
    },
  },
  optimizeDeps: {
    include: ["react", "react-dom", "@clerk/clerk-react"],
  },
});
