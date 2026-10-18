import { useCallback, useEffect, useState } from "react";
import type { AnimaDataKind, AnimaDataMap } from "../lib/anima/types";
import { getAnimaData, loadAnimaData, resetAnimaCache } from "../lib/anima/store";

type Snapshot<K extends AnimaDataKind> = {
  kind: K;
  data: AnimaDataMap[K] | null;
  loading: boolean;
  error: string | null;
};

/**
 * 按需加载一个词库子集。
 *
 * 缓存命中时直接从模块缓存派生，不在 effect 里同步 setState（避免级联渲染，
 * 也避免切分区时闪一下 loading）；只有异步完成/失败才落 snapshot。
 */
export function useAnimaData<K extends AnimaDataKind>(kind: K) {
  const [snapshot, setSnapshot] = useState<Snapshot<K>>(() => {
    const cached = getAnimaData(kind);
    return { kind, data: cached, loading: !cached, error: null };
  });
  const [revision, setRevision] = useState(0);

  const cached = getAnimaData(kind);
  const sameKind = snapshot.kind === kind;
  const data = cached ?? (sameKind ? snapshot.data : null);
  const loading = !data && (sameKind ? snapshot.loading : true);
  const error = sameKind ? snapshot.error : null;

  useEffect(() => {
    if (getAnimaData(kind)) return;
    let cancelled = false;
    loadAnimaData(kind)
      .then((value) => {
        if (!cancelled) setSnapshot({ kind, data: value, loading: false, error: null });
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setSnapshot({
            kind,
            data: null,
            loading: false,
            error: cause instanceof Error ? cause.message : String(cause),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [kind, revision]);

  const reload = useCallback(() => {
    resetAnimaCache(kind);
    setSnapshot({ kind, data: null, loading: true, error: null });
    setRevision((value) => value + 1);
  }, [kind]);

  return { data, loading, error, reload };
}
