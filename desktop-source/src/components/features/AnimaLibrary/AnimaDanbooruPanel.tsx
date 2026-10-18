import React, { useEffect, useState } from "react";
import { Check, Copy, ExternalLink, ImageDown, Plus, RefreshCw, Search } from "lucide-react";
import type { Toast } from "../../../types";
import type {
  DanbooruRating,
  DanbooruSnapshot,
  DanbooruState,
  DanbooruSettings,
  DanbooruTagGroup,
} from "../../../lib/anima/types";
import {
  DANBOORU_RATINGS,
  DANBOORU_SIZES,
  DEFAULT_BLOCKED_TAGS,
  RECOMMENDED_BLOCK_PRESETS,
  hasBlockTags,
  toggleBlockTags,
} from "../../../lib/anima/danbooru";
import { proxiedDanbooruImageUrl } from "../../../lib/anima/imageProxy";
import { AnimaSelect } from "./AnimaSelect";
import { AnimaMultiSelect } from "./AnimaMultiSelect";

type ToastFn = (type: Toast["type"], title: string, message?: string) => void;

const GROUP_LABELS: Record<DanbooruTagGroup, string> = {
  artist: "画师",
  character: "角色",
  copyright: "作品",
  general: "普通",
  meta: "元信息",
};

const GROUP_ORDER: DanbooruTagGroup[] = ["artist", "character", "copyright", "general", "meta"];

type Props = {
  state: DanbooruState;
  loading: boolean;
  error: string | null;
  onChangeSettings: (patch: Partial<DanbooruSettings>) => void;
  onRun: () => void;
  onApplyPrompt: (text: string, mode: "append" | "replace") => void;
  onFillComposer: (text: string) => void;
  onUseAsReference: (snapshot: DanbooruSnapshot) => Promise<void>;
  pushToast: ToastFn;
};

export const AnimaDanbooruPanel = React.memo(({
  state,
  loading,
  error,
  onChangeSettings,
  onRun,
  onApplyPrompt,
  onFillComposer,
  onUseAsReference,
  pushToast,
}: Props) => {
  const settings = state.settings;
  const last = state.last;
  const [uploading, setUploading] = useState(false);
  const [imageAttempt, setImageAttempt] = useState(0);
  const [imageFailed, setImageFailed] = useState(false);

  // 换了一张图就重置失败态；同一张图先试 sample，失败再试 original
  useEffect(() => {
    setImageAttempt(0);
    setImageFailed(false);
  }, [last?.id]);

  const imageCandidates = last
    ? (last.imageUrls?.length ? last.imageUrls : [last.imageUrl, last.fileUrl])
        .filter((url, index, list): url is string => Boolean(url) && list.indexOf(url) === index)
        .map(proxiedDanbooruImageUrl)
    : [];
  const imageUrl = imageCandidates[imageAttempt] ?? last?.imageUrl ?? "";

  const copy = (text: string, label: string) => {
    if (!text) return;
    void navigator.clipboard.writeText(text).then(
      () => pushToast("success", "已复制", label),
      () => pushToast("error", "复制失败", "浏览器剪贴板不可用"),
    );
  };

  const useAsReference = async () => {
    if (!last) return;
    setUploading(true);
    try {
      await onUseAsReference(last);
      pushToast("success", "已设为 Anima 参考图", `#${last.id} → 已开启图生图`);
    } catch (cause) {
      pushToast("error", "设为参考图失败", cause instanceof Error ? cause.message : String(cause));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="al-danbooru">
      <div className="al-danbooru-form">
        <label className="field al-query">
          <span>查询标签（空格分隔，最多 2 个普通标签）</span>
          <div className="al-inline">
            <input
              value={settings.query}
              onChange={(event) => onChangeSettings({ query: event.target.value })}
              placeholder="例如：1girl solo / flandre_scarlet"
              onKeyDown={(event) => {
                if (event.key === "Enter" && !loading) onRun();
              }}
            />
            <button type="button" className="primary-action" onClick={onRun} disabled={loading}>
              {loading ? <RefreshCw size={15} className="spin" /> : <Search size={15} />}
              {loading ? "抽取中…" : "抽一张"}
            </button>
          </div>
        </label>

        <div className="al-toolbar al-danbooru-toolbar">
          <div className="field">
            <span>分级（可多选）</span>
            <AnimaMultiSelect
              ariaLabel="分级"
              value={settings.ratings ?? ["g"]}
              options={DANBOORU_RATINGS}
              emptyLabel="全部（不限）"
              onChange={(values) => onChangeSettings({ ratings: values as DanbooruRating[] })}
            />
          </div>

          <div className="field">
            <span>图片尺寸</span>
            <AnimaSelect
              ariaLabel="图片尺寸"
              value={settings.size}
              options={DANBOORU_SIZES.map((size) => ({ value: size, label: size }))}
              onChange={(value) => onChangeSettings({ size: value as DanbooruSettings["size"] })}
            />
          </div>

          <div className="al-tag-groups">
            {GROUP_ORDER.map((group) => (
              <label key={group} className="al-checkbox al-checkbox-inline">
                <input
                  type="checkbox"
                  checked={settings.groups[group]}
                  onChange={(event) =>
                    onChangeSettings({ groups: { ...settings.groups, [group]: event.target.checked } })
                  }
                />
                {GROUP_LABELS[group]}
              </label>
            ))}
          </div>

          <label className="al-checkbox al-checkbox-inline" title={DEFAULT_BLOCKED_TAGS.join(", ")}>
            <input
              type="checkbox"
              checked={settings.useDefaultBlocklist}
              onChange={(event) => onChangeSettings({ useDefaultBlocklist: event.target.checked })}
            />
            屏蔽上传类标签
          </label>
        </div>

        <label className="field">
          <span>额外屏蔽词（逗号/空格分隔）</span>
          <input
            value={settings.blockTags}
            onChange={(event) => onChangeSettings({ blockTags: event.target.value })}
            placeholder="例如：text, signature"
          />
        </label>

        <div className="al-preset-tags">
          <span className="al-preset-label">推荐屏蔽词</span>
          {RECOMMENDED_BLOCK_PRESETS.map((preset) => {
            const on = hasBlockTags(settings.blockTags, preset.tags);
            return (
              <button
                key={preset.id}
                type="button"
                className={`al-preset-chip${on ? " is-on" : ""}`}
                title={preset.tags.join(", ")}
                aria-pressed={on}
                onClick={() =>
                  onChangeSettings({ blockTags: toggleBlockTags(settings.blockTags, preset.tags) })
                }
              >
                {on ? <Check size={12} /> : <Plus size={12} />}
                {preset.label}
              </button>
            );
          })}
        </div>

        {error && <div className="al-error-text">{error}</div>}
      </div>

      <div className="al-danbooru-result">
        {last ? (
          <>
            <div className="al-danbooru-head">
              <a href={last.postUrl} target="_blank" rel="noreferrer" className="al-link">
                #{last.id} <ExternalLink size={13} />
              </a>
              <span>rating {last.rating || "?"}</span>
              {last.width && last.height && <span>{last.width} × {last.height}</span>}
            </div>

            <div className="al-danbooru-image">
              {imageFailed || !imageUrl ? (
                <div className="al-image-fallback">
                  <div>图片加载失败（Danbooru 图片 CDN 可能不可达）</div>
                  <a href={last.postUrl} target="_blank" rel="noreferrer">
                    在 Danbooru 打开原图 <ExternalLink size={13} />
                  </a>
                  <button
                    type="button"
                    className="secondary-action"
                    onClick={() => {
                      setImageFailed(false);
                      setImageAttempt(0);
                    }}
                  >
                    重试
                  </button>
                </div>
              ) : (
                <img
                  key={imageUrl}
                  src={imageUrl}
                  alt={`Danbooru #${last.id}`}
                  referrerPolicy="no-referrer"
                  loading="lazy"
                  onError={() => {
                    // sample 挂了再退回 original；两者都失败才显示兜底
                    if (imageAttempt < imageCandidates.length - 1) {
                      setImageAttempt((value) => value + 1);
                    } else {
                      setImageFailed(true);
                    }
                  }}
                />
              )}
            </div>

            <div className="al-danbooru-groups">
              {GROUP_ORDER.map((group) => {
                const text = last.groups[group];
                if (!text) return null;
                return (
                  <div key={group} className="al-gacha-group">
                    <div className="al-danbooru-group-head">
                      <span className="al-gacha-group-label">{GROUP_LABELS[group]}</span>
                      <button type="button" className="al-mini-button" onClick={() => copy(text, GROUP_LABELS[group])}>
                        <Copy size={12} />
                      </button>
                    </div>
                    <div className="al-chips">
                      {text.split(", ").map((tag, index) => <span key={`${tag}-${index}`} className="al-chip">{tag}</span>)}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="al-gacha-actions">
              <button type="button" className="primary-action" onClick={() => onApplyPrompt(last.prompt, "append")} disabled={!last.prompt}>
                追加到提示词
              </button>
              <button type="button" className="secondary-action" onClick={() => onApplyPrompt(last.prompt, "replace")} disabled={!last.prompt}>
                覆盖
              </button>
              <button type="button" className="secondary-action" onClick={() => onFillComposer(last.prompt)} disabled={!last.prompt}>
                填入拼接台
              </button>
              <button type="button" className="secondary-action" onClick={useAsReference} disabled={uploading}>
                <ImageDown size={14} /> {uploading ? "上传中…" : "设为 Anima 参考图"}
              </button>
              <button type="button" className="secondary-action" onClick={onRun} disabled={loading}>换一张</button>
            </div>
          </>
        ) : (
          <div className="empty-state">
            输入标签后抽一张随机图。抽到的标签会按画师 / 角色 / 作品 / 普通分组显示，可直接写入提示词。
          </div>
        )}
      </div>
    </div>
  );
});
