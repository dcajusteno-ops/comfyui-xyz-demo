import React, { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

export type SelectOption = {
  value: string;
  label: string;
  /** 多选时触发器里用的短标签（弹层仍显示完整 label） */
  shortLabel?: string;
};

type Props = {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  /** 无障碍名称：原生 select 有 label，自定义按钮需要显式给 */
  ariaLabel: string;
  /** sm = 28px（分页条 / 面包屑等紧凑位置），md = 34px（工具栏 / 表单） */
  size?: "sm" | "md";
  /** 靠近右边界时右对齐，避免弹层溢出 */
  align?: "left" | "right";
  /** 撑满父容器宽度（表单 field 里替代 width:100% 的原生 select） */
  block?: boolean;
  className?: string;
  title?: string;
  disabled?: boolean;
};

/**
 * 统一的自定义下拉。
 *
 * 用它的原因：原生 <select> 的弹层由系统渲染，深色主题下列表仍是浅色底、选项文字
 * 却继承主题亮色（灰底白字几乎看不清），`color-scheme` 在 WebView2 也不可靠。
 * 这里用自带弹层替掉系统下拉：实底背景 + 主题令牌，明暗与壁纸模式都可读，
 * 顺带统一了触发器高度、圆角、焦点环与键盘操作。
 *
 * 样式类沿用 `.al-select*`（最早由 Anima 词库引入），避免与既有面板样式分叉。
 */
export const Select = React.memo(
  ({
    value,
    options,
    onChange,
    ariaLabel,
    size = "md",
    align = "left",
    block = false,
    className,
    title,
    disabled = false,
  }: Props) => {
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState(0);
    const rootRef = useRef<HTMLDivElement | null>(null);
    const listRef = useRef<HTMLDivElement | null>(null);
    const baseId = useId();

    const selectedIndex = Math.max(
      0,
      options.findIndex((option) => option.value === value),
    );
    const current = options[selectedIndex];

    useEffect(() => {
      if (!open) return;
      const onPointerDown = (event: PointerEvent) => {
        if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
      };
      document.addEventListener("pointerdown", onPointerDown, true);
      return () => document.removeEventListener("pointerdown", onPointerDown, true);
    }, [open]);

    useEffect(() => {
      if (!open) return;
      listRef.current
        ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
        ?.scrollIntoView({ block: "nearest" });
    }, [open, active]);

    const commit = (index: number) => {
      const option = options[index];
      if (option) onChange(option.value);
      setOpen(false);
    };

    const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (disabled) return;
      if (!open) {
        if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          setActive(selectedIndex);
          setOpen(true);
        }
        return;
      }
      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          setActive((index) => Math.min(options.length - 1, index + 1));
          break;
        case "ArrowUp":
          event.preventDefault();
          setActive((index) => Math.max(0, index - 1));
          break;
        case "Home":
          event.preventDefault();
          setActive(0);
          break;
        case "End":
          event.preventDefault();
          setActive(options.length - 1);
          break;
        case "Enter":
        case " ":
          event.preventDefault();
          commit(active);
          break;
        case "Escape":
          event.preventDefault();
          setOpen(false);
          break;
        case "Tab":
          setOpen(false);
          break;
        default:
          break;
      }
    };

    return (
      <div
        ref={rootRef}
        className={["al-select", size === "sm" ? "is-sm" : "", block ? "is-block" : "", className ?? ""]
          .filter(Boolean)
          .join(" ")}
      >
        <button
          type="button"
          className="al-select-trigger"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={ariaLabel}
          aria-controls={open ? `${baseId}-list` : undefined}
          title={title ?? ariaLabel}
          disabled={disabled}
          onClick={() => {
            setActive(selectedIndex);
            setOpen((prev) => !prev);
          }}
          onKeyDown={handleKeyDown}
        >
          <span className="al-select-value">{current?.label ?? ""}</span>
          <ChevronDown size={14} className="al-select-caret" />
        </button>

        {open && (
          <div
            ref={listRef}
            id={`${baseId}-list`}
            role="listbox"
            aria-label={ariaLabel}
            className={`al-select-popup${align === "right" ? " is-right" : ""}`}
          >
            {options.map((option, index) => {
              const selected = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  data-index={index}
                  className={[
                    "al-select-option",
                    index === active ? "is-active" : "",
                    selected ? "is-selected" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => commit(index)}
                >
                  <span>{option.label}</span>
                  {selected && <Check size={13} className="al-select-option-check" />}
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  },
);

Select.displayName = "Select";
