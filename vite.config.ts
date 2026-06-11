import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { xyzExampleImagesPlugin } from "./server/exampleImages";

const comfyTarget = process.env.COMFYUI_URL ?? "http://127.0.0.1:8188";

export default defineConfig({
  plugins: [xyzExampleImagesPlugin(comfyTarget), react()],
  server: {
    port: 9999,
    open: true,
    proxy: {
      "/comfy": {
        target: comfyTarget,
        changeOrigin: false,
        ws: true,
        rewrite: (path) => path.replace(/^\/comfy/, ""),
      },
    },
  },
  preview: {
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
