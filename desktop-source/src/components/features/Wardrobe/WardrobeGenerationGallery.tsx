import { ModalFrame } from "../../ui";
import type { OutputImage } from "../../../types";

type Props = {
  images: OutputImage[];
  generating: boolean;
  progress: { done: number; total: number };
  onOpenImage: (url: string, originalUrl?: string) => void;
  onClose: () => void;
};

/** 连续生图 / 多张结果的查看器：统一比例的大图网格，点击交给全局灯箱。 */
export function WardrobeGenerationGallery({
  images,
  generating,
  progress,
  onOpenImage,
  onClose,
}: Props) {
  return (
    <ModalFrame
      title={`造型台生成结果 · ${images.length}`}
      onClose={onClose}
      style={{
        width: "min(1120px, 94vw)",
        height: "86vh",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div className="wd-gen-gallery">
        <div className="wd-gen-gallery-head">
          <span>
            {generating
              ? `连续生图中 ${progress.done}/${progress.total} · 已完成 ${images.length} 张`
              : `共 ${images.length} 张`}
          </span>
          <span className="wd-muted">最新在前 · 点击任意一张查看大图</span>
        </div>
        {images.length === 0 ? (
          <div className="empty-state">还没有生成结果</div>
        ) : (
          <div className="wd-gen-gallery-grid">
            {images.map((image, index) => (
              <button
                type="button"
                className="wd-gen-gallery-card"
                key={`${image.url}-${index}`}
                onClick={() => onOpenImage(image.url, image.originalUrl)}
                title="查看大图"
              >
                <img
                  src={image.url}
                  alt={`生成结果 ${images.length - index}`}
                  loading="lazy"
                />
                <span className="wd-gen-gallery-badge">#{images.length - index}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="panel-footer wd-modal-foot wd-gen-gallery-foot">
        <span className="wd-muted">共 {images.length} 张</span>
        <button type="button" className="primary-action" onClick={onClose}>
          关闭
        </button>
      </div>
    </ModalFrame>
  );
}
