import { X } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

export function ModalFrame({ title, children, onClose, className, style }: { title: string; children: ReactNode; onClose: () => void; className?: string; style?: CSSProperties }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div className={`modal ${className || ""}`} style={style} role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon-button" onClick={onClose}><X size={16} /> 关闭</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function PanelTitle({ icon: Icon, title }: { icon: any; title: string }) {
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
