/** 造型台数据的预加载（引擎整包就绪后才允许抽取）。 */
import { useEffect, useState } from "react";
import { loadWardrobeEngine, resetWardrobeCache } from "../lib/wardrobe/store";

export function useWardrobeData() {
  const [revision, setRevision] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setError(null);
    loadWardrobeEngine()
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [revision]);

  return {
    ready,
    error,
    reload: () => {
      resetWardrobeCache();
      setRevision((v) => v + 1);
    },
  };
}
