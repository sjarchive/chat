import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Vite + React + TypeScript client for the Cloudflare Worker (see
// wrangler.jsonc). `envPrefix` keeps the existing NEXT_PUBLIC_* variable names
// working unchanged — .env.local locally, and the Workers Builds build env on
// deploy — so no variable renames were needed anywhere.
export default defineConfig({
  plugins: [react()],
  envPrefix: ["VITE_", "NEXT_PUBLIC_"],
  resolve: {
    alias: {
      "@": path.dirname(fileURLToPath(import.meta.url)),
    },
  },
});
