import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AppProvider } from "./AppContext";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { MobileTagPage } from "./components/mobile";
import { applyBootTheme, bootUiState } from "./lib/uiStateStore";
import "./styles.css";

// 手机端入口：#/mobile-tag（局域网内手机访问），不挂载桌面端主壳
const isMobileTagPage = window.location.hash.startsWith("#/mobile-tag");

// 启动门：持久化状态已从 localStorage 迁到服务端 data/ui-state.json，先拉取再渲染
// （本地服务通常 <10ms；失败降级 offline，hook 自动回退 localStorage，永不变砖）。
// 拿到数据后、首帧前同步应用主题，避免 dark 用户看到一帧 light。
void (async () => {
  await bootUiState();
  applyBootTheme();
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <ErrorBoundary>
        {isMobileTagPage ? (
          <MobileTagPage />
        ) : (
          <AppProvider>
            <App />
          </AppProvider>
        )}
      </ErrorBoundary>
    </React.StrictMode>,
  );
})();
