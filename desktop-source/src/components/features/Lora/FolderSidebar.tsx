import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { ChevronDown, ChevronRight, Folder, FolderOpen } from "lucide-react";
import type { FolderTreeNode } from "../../../types";
import { collectAncestorPaths } from "../../../lib/lora-helper";
import { usePersistentState } from "../../../hooks/usePersistentState";

export const FolderNodeButton = memo(({
  folder,
  selected,
  level,
  collapsed,
  onToggle,
  onSelect,
}: {
  folder: FolderTreeNode;
  selected: string;
  level: number;
  collapsed: Set<string>;
  onToggle: (path: string) => void;
  onSelect: (folder: string) => void;
}) => {
  const hasChildren = folder.children.length > 0;
  const isCollapsed = hasChildren && collapsed.has(folder.path);
  return (
    <div className="lm-folder-node">
      <div className="lm-folder-row">
        <button
          type="button"
          className={selected === folder.path ? "selected" : ""}
          onClick={() => onSelect(folder.path)}
          style={{ paddingLeft: 12 + level * 16 }}
          title={folder.path}
        >
          <Folder size={15} />
          <span>{folder.name}</span>
        </button>
        {hasChildren && (
          <button
            type="button"
            className="lm-folder-toggle"
            onClick={() => onToggle(folder.path)}
            aria-expanded={!isCollapsed}
            aria-label={`${isCollapsed ? "展开" : "收起"} ${folder.name}`}
            title={isCollapsed ? "展开" : "收起"}
          >
            {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          </button>
        )}
      </div>
      {!isCollapsed && folder.children.map((child) => (
        <FolderNodeButton folder={child} selected={selected} level={level + 1} collapsed={collapsed} onToggle={onToggle} onSelect={onSelect} key={child.path} />
      ))}
    </div>
  );
});

export const FolderSidebar = memo(({
  label,
  folders,
  selected,
  total,
  onSelect,
}: {
  label: string;
  folders: FolderTreeNode[];
  selected: string;
  total: number;
  onSelect: (folder: string) => void;
}) => {
  const sidebarRef = useRef<HTMLElement>(null);
  // 折叠集合：服务端持久化（任务书 v1.2 D5/D6 采纳，经 usePersistentState 落 data/ui-state.json），按路径存储，失效路径无害
  const [collapsedPaths, setCollapsedPaths] = usePersistentState<string[]>("comfyui_lora_sidebar_collapsed", []);
  const collapsed = useMemo(() => new Set(collapsedPaths), [collapsedPaths]);

  const handleToggleFolder = useCallback((path: string) => {
    setCollapsedPaths((prev) => (
      prev.includes(path) ? prev.filter((item) => item !== path) : [...prev, path]
    ));
  }, []);

  // 祖先自动展开：选中项位于折叠父级内时，移除其全部祖先的折叠状态（任务书 3.2.2）
  useEffect(() => {
    const ancestors = collectAncestorPaths(selected);
    if (ancestors.length === 0) return;
    setCollapsedPaths((prev) => {
      const next = prev.filter((path) => !ancestors.includes(path));
      return next.length === prev.length ? prev : next;
    });
  }, [selected]);

  // 挂载记忆滚动 + 选中/折叠状态变化后滚动到选中项（block: nearest 幂等，任务书 3.2.3）
  useEffect(() => {
    const selectedEl = sidebarRef.current?.querySelector(".selected") as HTMLElement | null;
    selectedEl?.scrollIntoView({ block: "nearest" });
  }, [selected, collapsedPaths]);

  return (
    <aside className="lm-folder-sidebar" ref={sidebarRef}>
      <button type="button" className={selected === "" ? "lm-sidebar-root selected" : "lm-sidebar-root"} onClick={() => onSelect("")}>
        <span className="lm-sidebar-root-label"><FolderOpen size={16} /> 全部 {label}</span>
        <small>{total}</small>
      </button>
      <div className="lm-folder-tree">
        {folders.map((folder) => (
          <FolderNodeButton folder={folder} selected={selected} level={0} collapsed={collapsed} onToggle={handleToggleFolder} onSelect={onSelect} key={folder.path} />
        ))}
        {folders.length === 0 && <div className="empty-strip">暂无文件夹</div>}
      </div>
    </aside>
  );
});
