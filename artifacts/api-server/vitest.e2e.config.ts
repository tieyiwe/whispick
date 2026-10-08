import { defineConfig } from "vitest/config";

// `pnpm exec vitest run --config vitest.e2e.config.ts` — see e2e/README.md.
export default defineConfig({
  test: {
    environment: "node",
    include: ["e2e/**/*.e2e.ts"],
    setupFiles: ["./e2e/setup.ts"],
    testTimeout: 0,
    hookTimeout: 0,
  },
});
