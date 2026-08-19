import { memo } from "react";
import { ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
import type { TabId } from "../../types";

type TabConfig = { id: TabId; label: string; icon: any };

export const AppSidebar = memo(({
  isCollapsed,
  onToggle,
  activeTab,
  onTabChange,
  generationTabs,
  toolTabs,
}: {
  isCollapsed: boolean;
  onToggle: () => void;
  activeTab: TabId;
  onTabChange: (id: TabId) => void;
  generationTabs: TabConfig[];
  toolTabs: TabConfig[];
}) => {
  return (
    <aside className={isCollapsed ? "app-sidebar is-collapsed" : "app-sidebar"}>
      <div className="sidebar-header">
        <div className="brand-mark">
          <Sparkles size={22} />
        </div>
        {!isCollapsed && <h1>ComfyUI XYZ</h1>}
      </div>
      
      <nav className="sidebar-nav">
        <div className="nav-section">
          {!isCollapsed && <label>生图模板</label>}
          {generationTabs.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                className={activeTab === item.id ? "nav-item active" : "nav-item"}
                onClick={() => onTabChange(item.id)}
                title={item.label}
              >
                <Icon size={20} />
                {!isCollapsed && <span>{item.label}</span>}
              </button>
            );
          })}
        </div>
        
        <div className="nav-divider" />
        
        <div className="nav-section">
          {!isCollapsed && <label>工具组件</label>}
          {toolTabs.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                className={activeTab === item.id ? "nav-item active" : "nav-item"}
                onClick={() => onTabChange(item.id)}
                title={item.label}
              >
                <Icon size={20} />
                {!isCollapsed && <span>{item.label}</span>}
              </button>
            );
          })}
        </div>
      </nav>

      <div className="sidebar-footer">
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
