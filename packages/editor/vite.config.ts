import { defineConfig } from "vitest/config";

export default defineConfig({
  server: {
    port: 1430,
    strictPort: true,
  },
  test: {
    environment: "jsdom",
  },
});
