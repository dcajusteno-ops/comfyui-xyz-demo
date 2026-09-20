import { defineConfig } from "@playwright/test";

// E2E 冒烟测试：不依赖 ComfyUI 运行（/comfy/** 与 /api/** 由 e2e/mocks.ts 在路由层 mock）
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 0,
  webServer: {
    command: "npm run dev -- --port 5199 --strictPort",
    url: "http://127.0.0.1:5199",
    reuseExistingServer: true,
    env: { DSH_E2E: "1" },
    timeout: 90_000,
  },
  use: {
    baseURL: "http://127.0.0.1:5199",
  },
});
