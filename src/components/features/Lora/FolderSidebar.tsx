import { memo, useEffect, useRef } from "react";
import { Folder, FolderOpen } from "lucide-react";
import type { FolderTreeNode } from "../../../types";

export const FolderNodeButton = memo(({
  folder,
  selected,
  level,
  onSelect,
}: {
  folder: FolderTreeNode;
  selected: string;
  level: number;
  onSelect: (folder: string) => void;
}) => {
  return (
    <div className="lm-folder-node">
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
      {folder.children.map((child) => (
        <FolderNodeButton folder={child} selected={selected} level={level + 1} onSelect={onSelect} key={child.path} />
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

  useEffect(() => {
    if (sidebarRef.current) {
      const selectedEl = sidebarRef.current.querySelector(".selected") as HTMLElement;
      if (selectedEl) {
        selectedEl.scrollIntoView({ block: "nearest" });
      }
    }
  }, []);

  return (
    <aside className="lm-folder-sidebar" ref={sidebarRef}>
      <button type="button" className={selected === "" ? "lm-sidebar-root selected" : "lm-sidebar-root"} onClick={() => onSelect("")}>
        <span className="lm-sidebar-root-label"><FolderOpen size={16} /> 全部 {label}</span>
        <small>{total}</small>
      </button>
      <div className="lm-folder-tree">
        {folders.map((folder) => (
          <FolderNodeButton folder={folder} selected={selected} level={0} onSelect={onSelect} key={folder.path} />
        ))}
        {folders.length === 0 && <div className="empty-strip">暂无文件夹</div>}
      </div>
    </aside>
  );
});
