import { useCallback, useEffect, useState } from "react";
import type { MobileTask, MobileTaskParams } from "../types";

const API_BASE = "/api/mobile";

/**
 * 手机上传识别任务的共享数据源：
 * REST 拉取全量 + SSE 实时增量（task-updated 事件），断线重连时以全量对账。
 */
export function useMobileTasks() {
  const [tasks, setTasks] = useState<MobileTask[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/tasks`);
      if (!res.ok) return;
      const data = (await res.json()) as { tasks?: MobileTask[] };
      setTasks(data.tasks ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const es = new EventSource(`${API_BASE}/events`);
    es.onopen = () => {
      // EventSource 每次（重）连接都全量对账，保证与服务器一致
      void refresh();
    };
    es.addEventListener("task-updated", (event) => {
      try {
        const task = JSON.parse((event as MessageEvent).data) as MobileTask;
        setTasks((prev) => {
          const index = prev.findIndex((t) => t.id === task.id);
          if (index >= 0) {
            const next = [...prev];
            next[index] = task;
            return next;
          }
          return [task, ...prev];
        });
      } catch {
        // 忽略畸形消息
      }
    });
    return () => es.close();
  }, [refresh]);

  const submit = useCallback(async (file: File, params: MobileTaskParams): Promise<string> => {
    const form = new FormData();
    form.set("image", file);
    form.set("params", JSON.stringify(params));
    const res = await fetch(`${API_BASE}/tasks`, { method: "POST", body: form });
    const data = (await res.json()) as { success: boolean; id?: string; error?: string };
    if (!data.success || !data.id) {
      throw new Error(data.error || "提交失败");
    }
    return data.id;
  }, []);

  const remove = useCallback(async (id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    await fetch(`${API_BASE}/tasks/${id}`, { method: "DELETE" });
  }, []);

  const clear = useCallback(async () => {
    setTasks([]);
    await fetch(`${API_BASE}/tasks`, { method: "DELETE" });
  }, []);

  return { tasks, loading, submit, remove, clear, refresh };
}