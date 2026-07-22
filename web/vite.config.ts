import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Served at the root of its own Azure Static Web Apps origin (research.md
  // R1 addendum) — no longer shares an origin with the coverage report or
  // legal pages, so a root base + clean-path routing is safe here.
  base: "/",
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      shared: path.resolve(__dirname, "../shared"),
    },
  },
  server: {
    // Dev server must be able to serve ../shared/ (types + tokens), which
    // lives outside this package's root.
    fs: { allow: [".."] },
  },
});
