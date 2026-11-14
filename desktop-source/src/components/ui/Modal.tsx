import { X, type LucideIcon } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * 弹窗统一挂到 body：`position: fixed` 的遮罩层一旦渲染在 `.workspace` 内，
 * 祖先的 `backdrop-filter`（壁纸模式）会把它变成自己的包含块 —— 遮罩被缩到内容区、
 * 弹窗超高时底部被裁掉（底栏只剩半截），页面底部还会多出一条浅色横带。
 */
export function ModalFrame({ title, children, onClose, className, style }: { title: string; children: ReactNode; onClose: () => void; className?: string; style?: CSSProperties }) {
  return createPortal(
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div className={`modal ${className || ""}`} style={style} role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon-button" onClick={onClose}><X size={16} /> 关闭</button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function PanelTitle({ icon: Icon, title }: { icon: LucideIcon; title: string }) {
  return (
    <div className="panel-title">
      <Icon size={20} />
      <h2>{title}</h2>
    </div>
  );
}

export function FeatureModal({ modal, onClose }: { modal: { title: string; body: string }; onClose: () => void }) {
  return (
    <ModalFrame title={modal.title} onClose={onClose}>
      <div className="help-body">
        <p>{modal.body}</p>
      </div>
    </ModalFrame>
  );
}
