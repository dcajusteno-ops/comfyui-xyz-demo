import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, RotateCcw } from "lucide-react";
import {
  ADVANCED_PALETTE_GROUPS,
  BASE_FALLBACK,
  PALETTE_GROUPS,
  effectiveToken,
  isThemeEditable,
  parseColor,
  toHex,
} from "../../lib/theme";
import type { PaletteGroup, PaletteToken, ThemeDefinition } from "../../lib/theme";

/** 把任意受支持的颜色摊成取色器要的 #rrggbb（rgba 保留自身 rgb，忽略 alpha） */
function swatchHex(value: string | undefined, fallback: string | undefined): string {
  const c = parseColor(value) ?? parseColor(fallback);
  return c ? toHex(c) : "#000000";
}

function PaletteRow({
  item,
  theme,
  disabled,
  onChange,
  onClear,
}: {
  item: PaletteToken;
  theme: ThemeDefinition;
  disabled: boolean;
  onChange: (token: string, value: string | null) => void;
  onClear: (token: string) => void;
}) {
  const builtinValue = BASE_FALLBACK[theme.base][item.token];
  const own = theme.palette[item.token];
  const effective = effectiveToken(theme, item.token) ?? "";
  const overridden = own !== undefined;

  return (
    <div className="theme-palette-row">
      <span className="theme-palette-label" title={item.token}>
        {item.label}
        {overridden && <em className="theme-palette-overridden">已改</em>}
      </span>

      {!item.textOnly && (
        <input
          type="color"
          className="theme-palette-swatch"
          value={swatchHex(effective, builtinValue)}
          disabled={disabled}
          onChange={(e) => onChange(item.token, e.target.value)}
          aria-label={`${item.label} 取色`}
        />
      )}

      <input
        type="text"
        className="theme-palette-text"
        value={own ?? ""}
        disabled={disabled}
        placeholder={builtinValue ?? "（继承）"}
        spellCheck={false}
        onChange={(e) => onChange(item.token, e.target.value)}
        aria-label={`${item.label} 颜色值`}
      />

      <button
        type="button"
        className="theme-icon-btn"
        title={overridden ? "还原为内置值" : "当前就是内置值"}
        disabled={disabled || !overridden}
        onClick={() => onClear(item.token)}
      >
        <RotateCcw size={13} />
      </button>
    </div>
  );
}

function PaletteGroupBlock({
  group,
  theme,
  disabled,
  onChange,
  onClear,
}: {
  group: PaletteGroup;
  theme: ThemeDefinition;
  disabled: boolean;
  onChange: (token: string, value: string | null) => void;
  onClear: (token: string) => void;
}) {
  return (
    <section className="theme-palette-group">
      <h4>{group.label}</h4>
      <div className="theme-palette-rows">
        {group.tokens.map((item) => (
          <PaletteRow
            key={item.token}
            item={item}
            theme={theme}
            disabled={disabled}
            onChange={onChange}
            onClear={onClear}
          />
        ))}
      </div>
    </section>
  );
}

/**
 * 全量调色板编辑器。
 * 基础组常显、高级组折叠；未覆盖的令牌不写进 palette（靠 styles.css 的 :root / .dark 级联），
 * 所以「还原」= 从 palette 里删掉该键。
 */
export function PaletteEditor({
  theme,
  onChange,
}: {
  theme: ThemeDefinition;
  onChange: (palette: Record<string, string>) => void;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const disabled = !isThemeEditable(theme);

  const overriddenCount = useMemo(() => Object.keys(theme.palette).length, [theme.palette]);

  const setToken = (token: string, value: string | null) => {
    const next = { ...theme.palette };
    if (value === null || value.trim() === "") {
      delete next[token];
    } else {
      next[token] = value.trim();
    }
    onChange(next);
  };

  return (
    <div className="theme-editor-body">
      {disabled && (
        <p className="theme-hint">
          这套主题不可就地修改（内置 / 预置）。点上方「复制并编辑」，或在左侧列表里用「复制」生成一份可编辑副本。
        </p>
      )}

      <p className="theme-hint">
        只覆盖你改过的项；其余跟随{theme.base === "dark" ? "深色" : "浅色"}内置值。已覆盖 {overriddenCount} 项。
        <button
          type="button"
          className="theme-link-btn"
          disabled={disabled || overriddenCount === 0}
          onClick={() => onChange({})}
        >
          全部还原
        </button>
      </p>

      {PALETTE_GROUPS.map((group) => (
        <PaletteGroupBlock
          key={group.id}
          group={group}
          theme={theme}
          disabled={disabled}
          onChange={setToken}
          onClear={(token) => setToken(token, null)}
        />
      ))}

      <button
        type="button"
        className="theme-advanced-toggle"
        onClick={() => setAdvancedOpen((v) => !v)}
      >
        {advancedOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        高级（中性阶 / 装饰 / 局部组件）
      </button>

      {advancedOpen &&
        ADVANCED_PALETTE_GROUPS.map((group) => (
          <PaletteGroupBlock
            key={group.id}
            group={group}
            theme={theme}
            disabled={disabled}
            onChange={setToken}
            onClear={(token) => setToken(token, null)}
          />
        ))}
    </div>
  );
}
