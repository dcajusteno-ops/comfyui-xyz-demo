/** 造型台输出文本的规整（写入 Anima 正向提示词前的最后一步）。 */
import { SHEET_DEFAULT_STYLE } from "../characterSheet";

/** 与三视图同源的 Anima 画质词；只做可选前缀，不参与 draw 对拍。 */
export const ANIMA_QUALITY_PREFIX = SHEET_DEFAULT_STYLE.anima;

export function toApplyText(text: string, withQualityPrefix = false): string {
  const clean = String(text ?? "").trim();
  if (!clean) return "";
  if (!withQualityPrefix) return clean;
  if (clean.toLowerCase().includes("masterpiece")) return clean;
  return `${ANIMA_QUALITY_PREFIX}, ${clean}`;
}

export function countTags(text: string): number {
  return String(text ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean).length;
}
