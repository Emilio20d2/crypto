import { defineConfig } from "vitest/config";

// Root monorepo vitest config.
// apps/web tests are excluded here — they run separately with jsdom via their
// own vite.config.ts (cd apps/web && npx vitest run).
// dist/** excluded so compiled JS outputs of TypeScript packages don't get
// picked up as duplicate test suites.
export default defineConfig({
  test: {
    exclude: ["apps/web/**", "node_modules/**", "**/node_modules/**", "**/dist/**"],
  },
});
