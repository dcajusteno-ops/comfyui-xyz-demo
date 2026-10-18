import React, { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

import type { AnimaSelectOption } from "./AnimaSelect";

type Props = {
  value: string[];
  options: AnimaSelectOption[];
  onChange: (values: string[]) => void;
  ariaLabel: string;
  /** 一个都没选时的显示文案；同时会在弹层顶部提供「清空」入口 */
  emptyLabel?: string;
  size?: "sm" | "md";
  align?: "left" | "right";
  className?: string;
};

/**
 * 多选版下拉。外观与 AnimaSelect 一致，区别是选项点击后不关闭弹层，
 * 可以连续勾选；空数组表示「不限」。
 */
export const AnimaMultiSelect = React.memo(
  ({
    value,
    options,
    onChange,
    ariaLabel,
    emptyLabel = "全部（不限）",
    size = "md",
    align = "left",
    className,
  }: Props) => {
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState(0);
    const rootRef = useRef<HTMLDivElement | null>(null);
    const listRef = useRef<HTMLDivElement | null>(null);
    const baseId = useId();

    const selected = new Set(value);
    const summary = value.length
      ? options
          .filter((option) => selected.has(option.value))
          .map((option) => option.shortLabel ?? option.label)
          .join(" + ")
      : emptyLabel;

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

    const toggleValue = (target: string) => {
      const next = new Set(value);
      if (next.has(target)) next.delete(target);
      else next.add(target);
      onChange(options.filter((option) => next.has(option.value)).map((option) => option.value));
    };

    const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (!open) {
        if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          setActive(Math.max(0, options.findIndex((option) => selected.has(option.value))));
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
        case " ": {
          event.preventDefault();
          const option = options[active];
          if (option) toggleValue(option.value);
          break;
        }
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
        className={["al-select", size === "sm" ? "is-sm" : "", className ?? ""].filter(Boolean).join(" ")}
      >
        <button
          type="button"
          className="al-select-trigger"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={ariaLabel}
          aria-controls={open ? `${baseId}-list` : undefined}
          title={ariaLabel}
          onClick={() => {
            setActive(Math.max(0, options.findIndex((option) => selected.has(option.value))));
            setOpen((prev) => !prev);
          }}
          onKeyDown={handleKeyDown}
        >
          <span className="al-select-value">{summary}</span>
          <ChevronDown size={14} className="al-select-caret" />
        </button>

        {open && (
          <div
            ref={listRef}
            id={`${baseId}-list`}
            role="listbox"
            aria-label={ariaLabel}
            aria-multiselectable="true"
            className={`al-select-popup${align === "right" ? " is-right" : ""}`}
          >
            <button
              type="button"
              role="option"
              aria-selected={value.length === 0}
              className={[
                "al-select-option",
                "al-select-option-none",
                value.length === 0 ? "is-selected" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={() => onChange([])}
            >
              <span>{emptyLabel}</span>
              {value.length === 0 && <Check size={13} className="al-select-option-check" />}
            </button>

            {options.map((option, index) => {
              const on = selected.has(option.value);
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={on}
                  data-index={index}
                  className={[
                    "al-select-option",
                    index === active ? "is-active" : "",
                    on ? "is-selected" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => toggleValue(option.value)}
                >
                  <span>{option.label}</span>
                  {on && <Check size={13} className="al-select-option-check" />}
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  },
);

AnimaMultiSelect.displayName = "AnimaMultiSelect";
