import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { xyzExampleImagesPlugin } from "./server/exampleImages";
import { xyzLoraPlugin } from "./server/lora";
import { xyzMobileSyncPlugin } from "./server/mobileSync";
import { xyzNotesPlugin } from "./server/notes";
import { xyzPromptsPlugin } from "./server/prompts";

const comfyTarget = process.env.COMFYUI_URL ?? "http://127.0.0.1:8188";

export default defineConfig({
  plugins: [xyzNotesPlugin(), xyzPromptsPlugin(), xyzExampleImagesPlugin(comfyTarget), xyzLoraPlugin(), xyzMobileSyncPlugin(comfyTarget), react()],
  build: {
    rollupOptions: {
      output: {
        // 主 chunk 瘦身：react-dom 与 markdown 渲染库拆为独立 chunk（同步加载、行为零变化，稳定缓存并消除 500kB chunk 警告）
        manualChunks: {
          react: ["react", "react-dom", "react-dom/client"],
          markdown: ["marked", "dompurify"],
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
