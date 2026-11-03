import { memo } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Palette, Sparkles, type LucideIcon } from "lucide-react";
import type { TabId } from "../../types";
import { navGroups, type NavGroup } from "../../constants";
import { usePersistentState } from "../../hooks/usePersistentState";

type SidebarTab = { id: TabId; label: string; icon: LucideIcon };

/** 折叠的是「组」，不是页：状态持久化（ui-state），切页 / 重开都记得 */
const SIDEBAR_GROUPS_KEY = "comfyui_sidebar_groups";

function normalizeCollapsedGroups(merged: unknown): string[] {
  const known = new Set(navGroups.map((group) => group.id));
  if (!Array.isArray(merged)) return [];
  return merged.filter((id): id is string => typeof id === "string" && known.has(id));
}

export const AppSidebar = memo(({
  isCollapsed,
  onToggle,
  activeTab,
  onTabChange,
  onOpenThemePanel,
}: {
  isCollapsed: boolean;
  onToggle: () => void;
  activeTab: TabId;
  onTabChange: (id: TabId) => void;
  /** 打开主题面板（明暗切换已移入面板内部） */
  onOpenThemePanel: () => void;
}) => {
  const [foldedGroups, setFoldedGroups] = usePersistentState<string[]>(
    SIDEBAR_GROUPS_KEY,
    [],
    normalizeCollapsedGroups,
  );

  const toggleGroup = (id: string) =>
    setFoldedGroups((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );

  return (
    <aside className={isCollapsed ? "app-sidebar is-collapsed" : "app-sidebar"}>
      <div className="sidebar-header">
        <div className="brand-mark">
          <Sparkles size={22} />
        </div>
        {!isCollapsed && <h1>ComfyUI XYZ</h1>}
      </div>

      <nav className="sidebar-nav">
        {navGroups.map((group) => (
          <NavSection
            key={group.id}
            group={group}
            rail={isCollapsed}
            folded={foldedGroups.includes(group.id)}
            onToggleGroup={toggleGroup}
            activeTab={activeTab}
            onTabChange={onTabChange}
          />
        ))}
      </nav>

      <div className="sidebar-footer">
        <button
          type="button"
          className="theme-toggle"
          onClick={onOpenThemePanel}
          title="主题（配色 / 壁纸 / 明暗）"
        >
          <Palette size={18} />
          {!isCollapsed && <span>主题</span>}
        </button>

        <button
          type="button"
          className="collapse-toggle"
          onClick={onToggle}
          title={isCollapsed ? "展开" : "收起"}
        >
          {isCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          {!isCollapsed && <span>收起</span>}
        </button>
      </div>
    </aside>
  );
});

function NavSection({
  group,
  rail,
  folded,
  onToggleGroup,
  activeTab,
  onTabChange,
}: {
  group: NavGroup;
  /** 图标栏模式（侧边栏整体收起）：不渲染组头，也不响应折叠 */
  rail: boolean;
  folded: boolean;
  onToggleGroup: (id: string) => void;
  activeTab: TabId;
  onTabChange: (id: TabId) => void;
}) {
  const hasActive = group.tabs.some((item) => item.id === activeTab);
  const isFolded = folded && !rail;

  return (
    <div className="nav-section" data-group={group.id}>
      {!rail && (
        <button
          type="button"
          className={`nav-group-head${isFolded ? " is-folded" : ""}${hasActive ? " has-active" : ""}`}
          onClick={() => onToggleGroup(group.id)}
          title={isFolded ? `展开「${group.label}」（${group.tabs.length} 项）` : `收起「${group.label}」`}
          aria-expanded={!isFolded}
        >
          <span className="nav-group-label">{group.label}</span>
          {isFolded && hasActive && <span className="nav-group-dot" aria-label="组内有激活页" />}
          <span className="nav-group-meta">
            {isFolded ? `${group.tabs.length} 项` : ""}
            {isFolded ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
          </span>
        </button>
      )}
      {rail && <label>{group.label}</label>}
      {!isFolded &&
        group.tabs.map((item) => (
          <NavRow
            key={item.id}
            item={item}
            active={activeTab === item.id}
            rail={rail}
            accent={group.accent === true}
            onTabChange={onTabChange}
          />
        ))}
    </div>
  );
}

function NavRow({
  item,
  active,
  rail,
  accent,
  onTabChange,
}: {
  item: SidebarTab;
  active: boolean;
  rail: boolean;
  accent: boolean;
  onTabChange: (id: TabId) => void;
}) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      className={active ? "nav-item active" : "nav-item"}
      onClick={() => onTabChange(item.id)}
      title={item.label}
    >
      <Icon size={20} />
      {!rail && <span>{item.label}</span>}
      {!rail && accent && <span className="nav-item-dot" aria-hidden="true" />}
    </button>
  );
}

AppSidebar.displayName = "AppSidebar";
