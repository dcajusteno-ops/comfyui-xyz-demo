import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from "react";
import { ComfyClient } from "./lib/comfyClient";
import { ConnectionInfo, TabId } from "./types";
import { CONFIG } from "./config";
import { useLocalStorageState } from "./hooks/useLocalStorageState";

export type Theme = "light" | "dark";

interface AppContextType {
  apiBase: string;
  setApiBase: (base: string) => void;
  client: ComfyClient;
  connection: ConnectionInfo;
  tab: TabId;
  setTab: (tab: TabId) => void;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: (event?: React.MouseEvent | MouseEvent) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [apiBase, setApiBase] = useState(CONFIG.DEFAULT_API_BASE);
  const client = useMemo(() => new ComfyClient(apiBase), [apiBase]);
  const [connection, setConnection] = useState<ConnectionInfo>({ status: "checking" });
  const [tab, setTab] = useLocalStorageState<TabId>("comfyui_active_tab", "default");
  const [theme, setTheme] = useLocalStorageState<Theme>("xyz_theme", "light");

  useEffect(() => {
    const root = window.document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
  }, [theme]);

  const toggleTheme = useCallback((event?: React.MouseEvent | MouseEvent) => {
    const nextTheme = theme === "light" ? "dark" : "light";
    
    if (typeof document === "undefined" || !(document as any).startViewTransition) {
      setTheme(nextTheme);
      return;
    }

    const x = event ? (event as any).clientX : window.innerWidth / 2;
    const y = event ? (event as any).clientY : window.innerHeight / 2;
    const endRadius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y)
    );

    // Add class to disable standard CSS transitions during the view transition
    document.documentElement.classList.add("switching-theme");

    const transition = (document as any).startViewTransition(async () => {
      setTheme(nextTheme);
      // Wait for React to finish rendering if possible (startViewTransition waits for the promise)
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    transition.ready.then(() => {
      const clipPath = [
        `circle(0px at ${x}px ${y}px)`,
        `circle(${endRadius}px at ${x}px ${y}px)`,
      ];
      
      const animation = document.documentElement.animate(
        {
          clipPath,
        },
        {
          duration: 400,
          easing: "cubic-bezier(0.4, 0, 0.2, 1)",
          pseudoElement: "::view-transition-new(root)",
        }
      );

      // Clean up the class when animation finishes
      animation.onfinish = () => {
        document.documentElement.classList.remove("switching-theme");
      };
    });

    transition.finished.then(() => {
      document.documentElement.classList.remove("switching-theme");
    });
  }, [theme, setTheme]);

  useEffect(() => {
    client.startMonitoring();
    const unsubscribe = client.onStatusChange((info) => {
      setConnection(info);
    });
    return () => {
      unsubscribe();
      client.stopMonitoring();
    };
  }, [client]);

  const value = {
    apiBase,
    setApiBase,
    client,
    connection,
    tab,
    setTab,
    theme,
    setTheme,
    toggleTheme,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

export const useAppContext = () => {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error("useAppContext must be used within an AppProvider");
  }
  return context;
};
