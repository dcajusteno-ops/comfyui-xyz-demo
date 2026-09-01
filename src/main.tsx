import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AppProvider } from "./AppContext";
import { MobileTagPage } from "./components/mobile";
import "./styles.css";

// 手机端入口：#/mobile-tag（局域网内手机访问），不挂载桌面端主壳
const isMobileTagPage = window.location.hash.startsWith("#/mobile-tag");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isMobileTagPage ? (
      <MobileTagPage />
    ) : (
      <AppProvider>
        <App />
      </AppProvider>
    )}
  </React.StrictMode>,
);
