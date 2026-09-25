import { defineConfig } from "@playwright/test";

// E2E 冒烟测试：不依赖 ComfyUI 运行（/comfy/** 与 /api/** 由 e2e/mocks.ts 在路由层 mock）
// 默认 webServer 是 Vite dev server；DSH_EXE=1 时改为启动 Go exe（任务书-Go单文件exe.md 验收用，
// 需先经 scripts/build-exe.ps1 构建出 ComfyUI-XYZ-Web.exe，并设 PORT=5199）。
const useExe = process.env.DSH_EXE === "1";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 0,
  webServer: useExe
    ? {
        // 直接运行 Go exe（已内嵌前端），要求 exe 存在且监听 5199
        command: "ComfyUI-XYZ-Web.exe",
        url: "http://127.0.0.1:5199",
        reuseExistingServer: true,
        env: { DSH_E2E: "1", PORT: "5199" },
        timeout: 30_000,
      }
    : {
        // 直接调 vite 二进制，不经 npm：本机 `npm run` 被安全策略拦截，原命令会让 webServer 起不来
        command: "node node_modules/vite/bin/vite.js --port 5199 --strictPort",
        url: "http://127.0.0.1:5199",
        reuseExistingServer: true,
        env: { DSH_E2E: "1" },
        timeout: 90_000,
      },
  use: {
    baseURL: "http://127.0.0.1:5199",
  },
});
