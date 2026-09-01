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
  server: {
    port: 9999,
    open: true,
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
