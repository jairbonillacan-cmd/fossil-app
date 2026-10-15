import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Port 1420 is fixed: tauri.conf.json devUrl points here.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  test: {
    environment: "jsdom",
    // CI may share a machine with Rust builds: give jsdom + React imports
    // room when other jobs are compiling at the same time.
    testTimeout: 20_000,
  },
});
