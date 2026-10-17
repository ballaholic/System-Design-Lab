/// <reference types="vitest/config" />
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  server: {
    port: 5173,
    strictPort: true,
    // Same-origin API calls in development; the API also allows this origin via CORS for other setups.
    proxy: { "/api": { target: "http://localhost:5080", changeOrigin: false } },
  },
  build: {
    // supabase-js + Radix + router make up most of the app chunk. Revisit with route-level splitting
    // when the playground (React Flow) lands in Phase 2.
    chunkSizeWarningLimit: 700,
  },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    env: {
      VITE_SUPABASE_URL: "https://test-project.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_key_for_unit_tests",
      VITE_API_BASE_URL: "",
    },
  },
});
