import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { xyzExampleImagesPlugin } from "./server/exampleImages";
import { xyzFsBrowsePlugin } from "./server/fsBrowse";
import { xyzLauncherPlugin } from "./server/launcher";
import { xyzLoraPlugin } from "./server/lora";
import { xyzMobileGenPlugin } from "./server/mobileGen";
import { xyzMobileSyncPlugin } from "./server/mobileSync";
import { xyzNotesPlugin } from "./server/notes";
import { xyzPromptsPlugin } from "./server/prompts";
import { xyzWildcardsPlugin } from "./server/wildcards";

const comfyTarget = process.env.COMFYUI_URL ?? "http://127.0.0.1:8188";

export default defineConfig({
  // 注意：mobileGen 必须注册在 mobileSync **之前**——mobileSync 的中间件拦截所有 /api/mobile/*，
  // 若它先注册，/api/mobile/gen 永远到不了 mobileGen，只会得到 404。
  plugins: [xyzNotesPlugin(), xyzPromptsPlugin(), xyzWildcardsPlugin(), xyzFsBrowsePlugin(), xyzExampleImagesPlugin(comfyTarget), xyzLoraPlugin(), xyzLauncherPlugin(), xyzMobileGenPlugin(comfyTarget), xyzMobileSyncPlugin(comfyTarget), react()],
  build: {
    rollupOptions: {
      output: {
        // 主 chunk 瘦身：react-dom 与 sanitizer 拆为独立 chunk（同步加载、行为零变化，稳定缓存并消除 500kB chunk 警告）
        manualChunks: {
          react: ["react", "react-dom", "react-dom/client"],
          dompurify: ["dompurify"],
        },
      },
    },
  },
  server: {
    port: 9999,
    // E2E（Playwright webServer）通过环境变量 DSH_E2E=1 禁用自动打开浏览器
    open: process.env.DSH_E2E ? false : true,
    // 局域网可达：手机通过 http://<PC-LAN-IP>:9999 访问
    host: true,
    allowedHosts: true,
    proxy: {
      "/comfy": {
        target: comfyTarget,
        changeOrigin: false,
        ws: true,
        rewrite: (path) => path.replace(/^\/comfy/, ""),
      },

      "/proxy/aliyun": {
        target: "https://mt.cn-hangzhou.aliyuncs.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/proxy\/aliyun/, ""),
      },
    },
  },
  preview: {
    host: true,
    allowedHosts: true,
    proxy: {
      "/comfy": {
        target: comfyTarget,
        changeOrigin: false,
        ws: true,
        rewrite: (path) => path.replace(/^\/comfy/, ""),
      },
    },
  },
});
