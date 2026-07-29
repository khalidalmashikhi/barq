import { defineConfig } from "vitest/config";
import path from "node:path";

// Mirrors tsconfig.json's "@/*" path alias so tests can use the same
// imports as application code, and forces the automatic JSX runtime
// since esbuild does not honor tsconfig's "jsx": "preserve" (that
// setting targets Next.js's own compiler, not Vitest's).
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  esbuild: {
    jsx: "automatic",
  },
});
