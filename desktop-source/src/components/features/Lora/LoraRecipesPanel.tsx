import { useEffect, useState } from "react";
import { BadgePlus, ChefHat, Loader2, RefreshCw } from "lucide-react";
import type { ComfyClient } from "../../../lib/comfyClient";
import type { LoraRecipe, TemplateKind, Toast } from "../../../types";

/**
 * LoRA 配方（Recipes）面板（T7）。
 *
 * 配方能力（listRecipes / getRecipesForLora / getRecipeSyntax 等）早已封装在
 * comfyClient 里，但一直没有 UI——本组件只补界面，不改 client。
 * 「一键插入」复用详情弹窗已有的 onInsertWords（追加到目标模板正向提示词）。
 */
export function LoraRecipesPanel({
  client,
  hash,
  onInsertWords,
  onToast,
}: {
  client: ComfyClient;
  /** LoRA 的 sha256；缺失时不加载（Embedding / 未入库的模型没有配方） */
  hash?: string;
  onInsertWords?: (target: TemplateKind, words: string[]) => void;
  onToast: (type: Toast["type"], title: string, message?: string) => void;
}) {
  const [recipes, setRecipes] = useState<LoraRecipe[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [insertingId, setInsertingId] = useState<string | null>(null);

  useEffect(() => {
    if (!hash) return;
    let canceled = false;
    setLoading(true);
    setFailed(false);
    client
      .getRecipesForLora(hash)
      .then((items) => {
        if (!canceled) setRecipes(items);
      })
      .catch(() => {
        if (!canceled) setFailed(true);
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [client, hash]);

  if (!hash) return null;

  const recipeId = (recipe: LoraRecipe) =>
    String(recipe.recipe_id ?? recipe.id ?? recipe.file_path ?? "");
  const recipeTitle = (recipe: LoraRecipe) =>
    String(recipe.title ?? recipe.name ?? recipe.recipe_id ?? recipe.id ?? "未命名配方");

  async function insertRecipe(recipe: LoraRecipe) {
    const id = recipeId(recipe);
    if (!id) {
      onToast("error", "配方缺少 id", "无法获取配方语法");
      return;
    }
    setInsertingId(id);
    try {
      const syntax = await client.getRecipeSyntax(id);
      if (!syntax.trim()) {
        onToast("error", "配方语法为空", recipeTitle(recipe));
        return;
      }
      if (!onInsertWords) {
        navigator.clipboard?.writeText(syntax);
        onToast("success", "配方语法已复制", syntax);
        return;
      }
      onInsertWords("default", [syntax]);
      onToast("success", "配方已插入", `${recipeTitle(recipe)} → 默认生图正向提示词`);
    } catch (error) {
      onToast("error", "配方语法获取失败", error instanceof Error ? error.message : String(error));
    } finally {
      setInsertingId(null);
    }
  }

  return (
    <div className="lm-info-item lm-recipes" style={{ gridColumn: "1 / -1" }}>
      <div className="lm-section-head">
        <label>
          <ChefHat size={14} style={{ verticalAlign: "-2px", marginRight: 4 }} />
          配方 {recipes.length > 0 ? `(${recipes.length})` : ""}
        </label>
        <button
          type="button"
          className="lm-text-btn"
          disabled={loading}
          title="重新扫描该 LoRA 的配方"
          onClick={() => {
            if (hash) {
              setLoading(true);
              client
                .getRecipesForLora(hash)
                .then((items) => setRecipes(items))
                .catch(() => setFailed(true))
                .finally(() => setLoading(false));
            }
          }}
        >
          <RefreshCw size={14} className={loading ? "spin" : undefined} /> 刷新
        </button>
      </div>

      {loading && recipes.length === 0 && (
        <div className="muted-text" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Loader2 size={13} className="spin" /> 正在加载配方…
        </div>
      )}
      {!loading && failed && recipes.length === 0 && <span className="muted-text">配方加载失败（LoRA Manager 插件未就绪或无网络）</span>}
      {!loading && !failed && recipes.length === 0 && <span className="muted-text">该 LoRA 暂无配方</span>}

      {recipes.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {recipes.map((recipe, index) => {
            const id = recipeId(recipe);
            const busy = insertingId === id && id !== "";
            const baseModel = recipe.base_model ? String(recipe.base_model) : "";
            const prompt = recipe.prompt ? String(recipe.prompt) : "";
            return (
              <div
                key={id || index}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 10px",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  background: "var(--surface-alt)",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={recipeTitle(recipe)}>
                    {recipeTitle(recipe)}
                  </div>
                  {(baseModel || prompt) && (
                    <div style={{ fontSize: 12, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={prompt || baseModel}>
                      {[baseModel, prompt].filter(Boolean).join(" · ") || "—"}
                    </div>
                  )}
                </div>
                {onInsertWords && (
                  <button
                    type="button"
                    className="lm-text-btn"
                    disabled={busy || !id}
                    title="把配方语法追加到默认生图正向提示词"
                    onClick={() => void insertRecipe(recipe)}
                  >
                    {busy ? <Loader2 size={14} className="spin" /> : <BadgePlus size={14} />} 一键插入
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
