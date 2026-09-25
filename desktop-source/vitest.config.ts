import { defaultExclude, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    // e2e/ 归 Playwright（npm run test:e2e），vitest 只测单测
    exclude: [...defaultExclude, "e2e/**"],
  },
});
