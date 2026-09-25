import React from "react";
import { X } from "lucide-react";
import { MobileQrBox } from "./MobileQrBox";

export const MobileConnectDialog = ({ onClose }: { onClose: () => void }) => {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ width: "min(420px, 100%)" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>手机连接</h2>
          <button className="icon-button" onClick={onClose} title="关闭" style={{ background: "transparent", border: "none", color: "var(--muted)", cursor: "pointer", display: "flex", padding: 4 }}>
            <X size={18} />
          </button>
        </div>
        <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.7, marginBottom: 10 }}>
          手机与电脑连接<b>同一 Wi-Fi</b> 后，扫码或输入上方地址，即可在手机上选图/拍照，由电脑的 WD1.4 识别并返回 tags；结果会实时同步到「手机同步」列表。
        </div>
        <MobileQrBox />
        <div className="modal-actions" style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
          <button className="secondary-action" onClick={onClose} style={{ padding: "6px 16px", fontSize: 13 }}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
};