import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { ComfyClient } from "./lib/comfyClient";
import { ConnectionInfo, TabId } from "./types";
import { CONFIG } from "./config";
import { useLocalStorageState } from "./hooks/useLocalStorageState";

interface AppContextType {
  apiBase: string;
  setApiBase: (base: string) => void;
  client: ComfyClient;
  connection: ConnectionInfo;
  tab: TabId;
  setTab: (tab: TabId) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [apiBase, setApiBase] = useState(CONFIG.DEFAULT_API_BASE);
  const client = useMemo(() => new ComfyClient(apiBase), [apiBase]);
  const [connection, setConnection] = useState<ConnectionInfo>({ status: "checking" });
  const [tab, setTab] = useLocalStorageState<TabId>("comfyui_active_tab", "default");

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
