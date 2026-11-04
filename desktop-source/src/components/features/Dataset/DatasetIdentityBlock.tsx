import { useRef, useState } from "react";
import { AlertTriangle, ImagePlus, Plus, ShieldCheck, X } from "lucide-react";
import { TextField } from "../../ui";
import type { DatasetConfig, Toast } from "../../../types";

type PushToast = (type: Toast["type"], title: string, message?: string) => void;

/**
 * 角色锚点。
 *
 * 纯文生图 + 8 轴随机 = 100 张里 100 个不同的人，这样的数据集训练出来只会学到
 * 「一个泛化的人」。所以要么挂角色 LoRA（带触发词），要么用参考图 + 图生图，
 * 两者都没有时必须显式确认才能开跑。
 *
 * LoRA 的选择沿用项目原有的「简易 LoRA 管理器」（文件夹 / 模型类型 / 标签 / 搜索 /
 * 滚动加载都是全的），权重与启停仍在下方「模型与采样」的 LoRA 卡片里调。
 */
export function DatasetIdentityBlock({
  params,
  setParams,
  disabled,
  onSetSimpleLoraTarget,
  onUploadImage,
  pushToast,
}: {
  params: DatasetConfig;
  setParams: (updater: DatasetConfig | ((prev: DatasetConfig) => DatasetConfig)) => void;
  disabled: boolean;
  onSetSimpleLoraTarget: () => void;
  onUploadImage: (file: File) => Promise<string>;
  pushToast: PushToast;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const mode = params.mode;
  const modeParams = params[mode];
  const activeLoras = (modeParams.loras ?? []).filter((lora) => lora.active && lora.name);
  const referenceActive = params.reference.enabled && Boolean(params.reference.imageName);
  const anchored = activeLoras.length > 0 || referenceActive;

  const otherMode = mode === "anima" ? "sdxl" : "anima";
  const otherCount = (params[otherMode].loras ?? []).filter((lora) => lora.active && lora.name).length;

  const patchDenoise = (denoise: number) =>
    setParams((prev) =>
      prev.mode === "anima"
        ? { ...prev, anima: { ...prev.anima, denoise } }
        : { ...prev, sdxl: { ...prev.sdxl, denoise } },
    );

  const toggleReference = (enabled: boolean) => {
    const currentDenoise = Number(modeParams.denoise) || 1;
    const lower = enabled && currentDenoise > 0.95;
    setParams((prev) => ({ ...prev, reference: { ...prev.reference, enabled } }));
    if (lower) {
      patchDenoise(0.6);
      pushToast("info", "已下调重绘强度", `重绘 ${currentDenoise} 时参考图几乎不起作用，已改为 0.6`);
    }
  };

  const pickImage = async (file?: File | null) => {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const name = await onUploadImage(file);
      setParams((prev) => ({ ...prev, reference: { enabled: true, imageName: name } }));
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : String(uploadError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="ds-card">
      <header className="ds-card-head">
        <h3>角色锚点</h3>
        <span className={`ds-anchor-chip ${anchored ? "ok" : "warn"}`}>
          {anchored ? <ShieldCheck size={13} /> : <AlertTriangle size={13} />}
          {activeLoras.length > 0
            ? `LoRA × ${activeLoras.length}`
            : referenceActive
              ? "参考图锁定"
              : "未配置"}
        </span>
      </header>

      <div className="ds-lora">
        <div className="ds-lora-head">
          <span className="ds-lora-title">LoRA</span>
          <button type="button" className="ghost-btn" disabled={disabled} onClick={onSetSimpleLoraTarget}>
            <Plus size={14} /> 从 LoRA 管理器添加
          </button>
          {activeLoras.length > 0 && (
            <span className="ds-hint ds-ellipsis">
              {activeLoras.map((lora) => lora.displayName || lora.name).join(" / ")}
            </span>
          )}
        </div>
        <p className="ds-hint">
          {activeLoras.length
            ? `已挂 ${activeLoras.length} 个；权重 / 启用 / 删除在下方「模型与采样」的 LoRA 卡片里调。`
            : "未挂 LoRA。挂上后把触发词填到下面，生成时会一起进正向提示词。"}
        </p>
      </div>

      <TextField
        label="触发词"
        value={params.trigger}
        placeholder="训练目标词，如 mychar"
        disabled={disabled}
        onChange={(value) => setParams((prev) => ({ ...prev, trigger: value }))}
      />
      <p className="ds-hint">
        挂上 LoRA 时触发词会进正向提示词；没挂 LoRA 时它只进 caption（需开启下方「caption 带触发词」）。
      </p>
      {otherCount > 0 && (
        <p className="ds-hint ds-warn">
          另一族（{otherMode === "anima" ? "Anima" : "SDXL"}）已挂 {otherCount} 个，切到那一族才生效。
        </p>
      )}

      <div className="ds-divider" />

      <div className="ds-anchor-row">
        <label className="ds-inline">
          <input
            type="checkbox"
            checked={params.reference.enabled}
            disabled={disabled || busy}
            onChange={(event) => toggleReference(event.target.checked)}
          />
          用参考图锁人物
        </label>
        <button type="button" className="ghost-btn" disabled={disabled || busy} onClick={() => fileRef.current?.click()}>
          <ImagePlus size={14} /> {busy ? "上传中…" : params.reference.imageName ? "换一张" : "选择图片"}
        </button>
        {params.reference.imageName && (
          <button
            type="button"
            className="icon-btn"
            title="清除参考图"
            disabled={disabled}
            onClick={() => setParams((prev) => ({ ...prev, reference: { enabled: false, imageName: "" } }))}
          >
            <X size={14} />
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => {
            void pickImage(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </div>
      {params.reference.imageName && <p className="ds-hint ds-ellipsis">参考图：{params.reference.imageName}</p>}
      {referenceActive && Number(modeParams.denoise) > 0.8 && (
        <p className="ds-hint ds-warn">重绘 {modeParams.denoise}：人物会明显变化，建议 0.55–0.70</p>
      )}
      {error && <p className="ds-hint ds-warn">上传失败：{error}</p>}
    </section>
  );
}
