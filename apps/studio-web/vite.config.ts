// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const server = process.env.PSP_STUDIO_SERVER ?? "http://127.0.0.1:4810";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 4811,
    proxy: {
      "/api": { target: server, changeOrigin: false },
      "/studio/socket": { target: server, ws: true }
    }
  },
  build: { outDir: "dist", sourcemap: true },
  test: {
    environment: "jsdom",
    // Threads start faster than forks when the dev server and backend are already running.
    pool: "threads",
    // UI flows wait on real timers (assistant polling) and a lazily loaded editor chunk; a loaded
    // machine running the whole repository check needs more than the 5 s default.
    testTimeout: 20_000,
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"]
  }
});