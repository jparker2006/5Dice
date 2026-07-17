import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/game-core/**/*.ts"],
      exclude: ["src/game-core/**/*.test.ts", "src/game-core/index.ts"],
      reporter: ["text", "json-summary"],
    },
  },
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
    },
  },
});
