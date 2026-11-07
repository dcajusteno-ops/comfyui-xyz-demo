import React from "react";
import ReactDOM from "react-dom/client";

import { StandaloneImageManager } from "./components/features/ImageManager/StandaloneImageManager";
import { applyBootTheme, bootUiState } from "./lib/uiStateStore";
import "./styles.css";

/**
 * 外置图片管理器的入口（独立端口，浏览器打开）。
 *
 * 与主应用的区别：不挂 AppProvider / 侧边栏 / 输出栏，只渲染图片管理面板。
 * `/api/ui-state` 由同一个 Go 进程在独立端口上再挂一次，因此主题与
 * `comfyui_image_manager`（当前目录/排序）和主应用是同一份数据。
 */
void (async () => {
  await bootUiState();
  applyBootTheme();
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <StandaloneImageManager />
    </React.StrictMode>,
  );
})();
