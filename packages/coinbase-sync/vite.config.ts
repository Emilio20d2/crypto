import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    globalSetup: "./vitest.globalSetup.ts",
    include: ["src/**/*.test.ts"],
    exclude: ["dist/**", "node_modules/**"],
  },
});
