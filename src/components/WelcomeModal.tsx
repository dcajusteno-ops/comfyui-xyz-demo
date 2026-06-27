import React from "react";
import { Info, ExternalLink, X } from "lucide-react";

interface WelcomeModalProps {
  onClose: () => void;
}

export function WelcomeModal({ onClose }: WelcomeModalProps) {
  return (
    <div className="modal-backdrop" style={{ zIndex: 9999 }}>
      <div 
        className="modal" 
        style={{ 
          maxWidth: "600px", 
          width: "100%",
          padding: 0,
          background: "var(--surface)",
          border: "1px solid var(--border)",
          boxShadow: "0 24px 48px rgba(0,0,0,0.12)",
          borderRadius: "16px",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          maxHeight: "85vh",
          animation: "fadeScaleIn 0.3s cubic-bezier(0.16, 1, 0.3, 1)"
        }}
      >
        <div style={{
          background: "var(--surface-alt)",
          borderBottom: "1px solid var(--border)",
          padding: "24px 32px",
          color: "var(--text)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center"
        }}>
          <div>
            <h2 style={{ margin: 0, fontSize: "1.4rem", display: "flex", alignItems: "center", gap: "10px", fontWeight: 600 }}>
              <Info size={28} color="var(--accent)" />
              欢迎使用 ComfyUI XYZ 控制台
            </h2>
            <p style={{ margin: "8px 0 0 0", color: "var(--muted)", fontSize: "0.95rem" }}>
              本项目深度依赖以下 ComfyUI 第三方插件，请确保已正确安装：
            </p>
          </div>
          <button 
            onClick={onClose}
            style={{
              background: "transparent",
              border: "1px solid var(--border)",
              color: "var(--text)",
              borderRadius: "50%",
              width: "36px",
              height: "36px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              transition: "background 0.2s"
            }}
            onMouseOver={(e) => e.currentTarget.style.background = "var(--surface)"}
            onMouseOut={(e) => e.currentTarget.style.background = "transparent"}
          >
            <X size={20} />
          </button>
        </div>

        <div style={{ padding: "32px", display: "flex", flexDirection: "column", gap: "24px", background: "var(--surface)", overflowY: "auto", flex: 1 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <h3 style={{ margin: 0, fontSize: "1.1rem", color: "var(--text)", borderBottom: "1px solid var(--border)", paddingBottom: "8px" }}>核心插件列表</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <PluginLink 
            name="ComfyUI-Impact-Pack" 
            desc="提供人脸、手部等局部高清修复节点"
            url="https://github.com/ltdrdata/ComfyUI-Impact-Pack"
          />
          <PluginLink 
            name="rgthree-comfy" 
            desc="提供工作流内部的图像滑块对比节点"
            url="https://github.com/rgthree/rgthree-comfy"
          />
          <PluginLink 
            name="ComfyUI-WD14-Tagger" 
            desc="提供 WD1.4 提示词反推能力"
            url="https://github.com/pythongosssss/ComfyUI-WD14-Tagger"
          />
          <PluginLink 
            name="ComfyUI_Mira" 
            desc="提供 CL Tagger 提示词反推能力与附加组件"
            url="https://github.com/mirabarukaso/ComfyUI_Mira"
          />
          <PluginLink 
            name="ComfyUI-Prompt-Control" 
            desc="提供 LoRA 懒加载及提示词权重动态调度"
            url="https://github.com/asagi4/comfyui-prompt-control"
          />
          <PluginLink 
            name="ComfyUI-Danbooru-Gallery" 
            desc="提供 MultiCharacterEditorNode 多角色蒙版生成"
            url="https://github.com/Aaalice233/ComfyUI-Danbooru-Gallery"
          />
          <PluginLink 
            name="ComfyUI-Lora-Manager" 
            desc="提供原生的 LoRA 检索及元数据管理服务"
            url="https://github.com/willmiao/ComfyUI-Lora-Manager"
          />
          <PluginLink 
            name="was-node-suite-comfyui" 
            desc="提供 Text Concatenate 文本拼接等基础核心节点"
            url="https://github.com/WASasquatch/was-node-suite-comfyui"
          />
          <PluginLink 
            name="ComfyUI_yanc" 
            desc="提供目录读取及图片/文本批量存取扩展节点"
            url="https://github.com/ALatentPlace/ComfyUI_yanc"
          />
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "8px" }}>
            <h3 style={{ margin: 0, fontSize: "1.1rem", color: "var(--text)", borderBottom: "1px solid var(--border)", paddingBottom: "8px" }}>依赖的底层模型 (Models)</h3>
            <div style={{
              background: "rgba(245, 158, 11, 0.1)",
              borderLeft: "4px solid #f59e0b",
              padding: "12px 16px",
              borderRadius: "4px 8px 8px 4px",
              fontSize: "0.9rem",
              color: "#b45309"
            }}>
              <strong>⚠️ 注意：</strong> 下方的模型下载地址来自 HuggingFace 社区，随时可能因网络限制或原作者删除而失效。建议优先使用 ComfyUI Manager 进行自动安装，或自备网络环境下载。
            </div>
            
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <ModelLink 
                name="face_yolov8m.pt" 
                desc="用于 Impact Pack 脸部修复（中等模型）。请放入 models/ultralytics/bbox/ 目录"
                url="https://huggingface.co/Bingsu/adetailer/resolve/main/face_yolov8m.pt"
              />
              <ModelLink 
                name="face_yolov8n.pt" 
                desc="用于 Impact Pack 脸部修复（轻量模型）。请放入 models/ultralytics/bbox/ 目录"
                url="https://huggingface.co/Bingsu/adetailer/resolve/main/face_yolov8n.pt"
              />
              <ModelLink 
                name="face_yolov8s.pt" 
                desc="用于 Impact Pack 脸部修复（小模型）。请放入 models/ultralytics/bbox/ 目录"
                url="https://huggingface.co/Bingsu/adetailer/resolve/main/face_yolov8s.pt"
              />
              <ModelLink 
                name="hand_yolov8n.pt" 
                desc="用于 Impact Pack 手部修复（轻量模型）。请放入 models/ultralytics/bbox/ 目录"
                url="https://huggingface.co/Bingsu/adetailer/resolve/main/hand_yolov8n.pt"
              />
              <ModelLink 
                name="hand_yolov8s.pt" 
                desc="用于 Impact Pack 手部修复（小模型）。请放入 models/ultralytics/bbox/ 目录"
                url="https://huggingface.co/Bingsu/adetailer/resolve/main/hand_yolov8s.pt"
              />
              <ModelLink 
                name="Eyeful_v2-Individual.pt" 
                desc="用于 Impact Pack 眼部修复（单眼检测）。请放入 models/ultralytics/bbox/ 目录"
                url="https://civitai.com/models/150925/eyeful"
              />
              <ModelLink 
                name="ntd11_anime_nsfw_segm_v5.pt" 
                desc="用于 Impact Pack NSFW修复（语义分割）。请放入 models/ultralytics/segm/ 目录"
                url="https://civitai.com/models/261944"
              />
              <ModelLink 
                name="sam_vit_b_01ec64.pth" 
                desc="用于精确遮罩生成（Segment Anything）。请放入 models/sams/ 目录"
                url="https://dl.fbaipublicfiles.com/segment_anything/sam_vit_b_01ec64.pth"
              />
              <ModelLink 
                name="wd-v1-4-moat-tagger-v2" 
                desc="用于 WD1.4 反推（Moat 模型）。通常自动下载，若失败请放入 models/taggers/ 目录"
                url="https://huggingface.co/SmilingWolf/wd-v1-4-moat-tagger-v2"
              />
              <ModelLink 
                name="wd-v1-4-vit-tagger-v2" 
                desc="用于 WD1.4 反推（ViT 模型）。通常自动下载，若失败请放入 models/taggers/ 目录"
                url="https://huggingface.co/SmilingWolf/wd-v1-4-vit-tagger-v2"
              />
              <ModelLink 
                name="wd-v1-4-swinv2-tagger-v2" 
                desc="用于 WD1.4 反推（SwinV2 模型）。通常自动下载，若失败请放入 models/taggers/ 目录"
                url="https://huggingface.co/SmilingWolf/wd-v1-4-swinv2-tagger-v2"
              />
              <ModelLink 
                name="wd-v1-4-convnextv2-tagger-v2" 
                desc="用于 WD1.4 反推（ConvNextV2 模型）。通常自动下载，若失败请放入 models/taggers/ 目录"
                url="https://huggingface.co/SmilingWolf/wd-v1-4-convnextv2-tagger-v2"
              />
              <ModelLink 
                name="cl_tagger_1_02.onnx" 
                desc="用于 CL Tagger 的图像反推核心模型。请放入 models/onnx/cl_tagger/ 目录"
                url="https://github.com/mirabarukaso/ComfyUI_Mira"
              />
              <ModelLink 
                name="cl_tagger_1_02_tag_mapping.json" 
                desc="这是 CL Tagger 模型必需的标签映射文件，必须与 onnx 模型同名并放在同一目录下。"
                url="https://github.com/mirabarukaso/ComfyUI_Mira"
              />
            </div>
          </div>
        </div>

        <div style={{
          padding: "20px 32px",
          background: "var(--surface-alt)",
          borderTop: "1px solid var(--border)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center"
        }}>
          <span style={{ fontSize: "0.85rem", color: "var(--muted)", display: "flex", alignItems: "center", gap: "6px" }}>
            <Info size={14} /> 提示：后续可随时在右上角的「通知队列」中重新查阅此列表
          </span>
          <button 
            onClick={onClose}
            style={{
              padding: "10px 24px",
              background: "var(--accent)",
              color: "white",
              border: "none",
              borderRadius: "8px",
              fontWeight: 600,
              fontSize: "1rem",
              transition: "background 0.2s, transform 0.1s"
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.background = "var(--accent-hover)";
              e.currentTarget.style.transform = "scale(1.02)";
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.background = "var(--accent)";
              e.currentTarget.style.transform = "scale(1)";
            }}
            onMouseDown={(e) => e.currentTarget.style.transform = "scale(0.98)"}
          >
            我已了解，开始使用
          </button>
        </div>
      </div>
    </div>
  );
}

function PluginLink({ name, desc, url }: { name: string, desc: string, url: string }) {
  return (
    <a 
      href={url}
      target="_blank"
      rel="noreferrer"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "16px",
        background: "var(--surface-alt)",
        border: "1px solid var(--border)",
        borderRadius: "12px",
        textDecoration: "none",
        color: "inherit",
        transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)"
      }}
      onMouseOver={(e) => {
        e.currentTarget.style.borderColor = "var(--accent)";
        e.currentTarget.style.transform = "translateY(-2px)";
        e.currentTarget.style.boxShadow = "0 4px 12px var(--accent-soft)";
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.borderColor = "var(--border)";
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.boxShadow = "none";
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        <strong style={{ fontSize: "1.05rem", color: "var(--text)", display: "flex", alignItems: "center", gap: "8px" }}>
          {name}
        </strong>
        <span style={{ fontSize: "0.9rem", color: "var(--muted)" }}>{desc}</span>
      </div>
      <ExternalLink size={20} color="var(--accent)" style={{ opacity: 0.8 }} />
    </a>
  );
}

function ModelLink({ name, desc, url }: { name: string, desc: string, url: string }) {
  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      padding: "12px 16px",
      background: "var(--surface-alt)",
      border: "1px dashed var(--border-strong)",
      borderRadius: "8px",
      gap: "6px"
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <strong style={{ fontSize: "0.95rem", color: "var(--text)", fontFamily: "monospace" }}>{name}</strong>
        <a 
          href={url} 
          target="_blank" 
          rel="noreferrer"
          style={{ fontSize: "0.85rem", color: "var(--accent)", textDecoration: "none", display: "flex", alignItems: "center", gap: "4px" }}
        >
          下载模型 <ExternalLink size={14} />
        </a>
      </div>
      <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>{desc}</span>
    </div>
  );
}
