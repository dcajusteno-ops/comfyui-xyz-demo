import { ModalFrame } from "../../ui";

export function XyzHelpModal({ onClose }: { onClose: () => void }) {
  return (
    <ModalFrame title="XYZ 控制器怎么用" onClose={onClose}>
      <div className="help-body">
        <p>
          XYZ 会按 X、Y、Z 三个轴组合参数，然后顺序提交到 ComfyUI。X 轴变化最快，适合 seed；Y/Z 适合
          CFG、Steps、尺寸或 LoRA 强度。
        </p>
        <p>
          取值支持两种写法：逗号或换行枚举，例如 `5,7,9`；数值范围，例如 `20..40..10` 表示 20、30、40。
        </p>
        <p>
          “正向追加”会把轴值追加到正向提示词；多人模板中会追加到全局 prompt。“LoRA
          强度”可以动态调节当前模板中已选择的对应 LoRA 权重。
        </p>
      </div>
    </ModalFrame>
  );
}
