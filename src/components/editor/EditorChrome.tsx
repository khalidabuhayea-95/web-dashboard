"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ComponentType,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { ChevronDown } from "lucide-react";

/**
 * Shared chrome for the editor's header and contextual toolbar.
 *
 * Follows the dashboard's visual language: flat surfaces, pill-shaped controls, a neutral ramp
 * for idle states and brand teal only for "on" states. Shadows are reserved for things that
 * float (the contextual pill, popovers, menus).
 */

type IconComponent = ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export const FLOATING_SHADOW =
  "shadow-[0_1px_2px_rgba(16,18,21,0.06),0_8px_24px_-6px_rgba(16,18,21,0.14)]";

interface ToolButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: IconComponent;
  label?: ReactNode;
  /** Visually "on" (bold, curve enabled, panel open...). */
  active?: boolean;
  /** Show the label next to the icon; otherwise it is only the tooltip / aria-label. */
  showLabel?: boolean;
  chevron?: boolean;
  tone?: "default" | "danger";
}

export const ToolButton = forwardRef<HTMLButtonElement, ToolButtonProps>(function ToolButton(
  {
    icon: Icon,
    label,
    active = false,
    showLabel = false,
    chevron = false,
    tone = "default",
    className,
    children,
    title,
    "aria-label": ariaLabel,
    "aria-pressed": ariaPressed,
    ...props
  },
  ref
) {
  const text = typeof label === "string" ? label : undefined;
  // Popover triggers announce aria-expanded instead; only plain toggles report a pressed state.
  const pressed = ariaPressed ?? (props["aria-expanded"] === undefined && active ? true : undefined);
  return (
    <button
      ref={ref}
      type="button"
      aria-label={ariaLabel ?? text}
      aria-pressed={pressed}
      title={title ?? text}
      className={cx(
        "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-full text-[13px] font-medium transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-40",
        showLabel || children ? "px-2.5" : "w-8",
        active
          ? "bg-brand-teal/12 text-brand-teal"
          : tone === "danger"
            ? "text-[#c0362c] hover:bg-[#fdecea]"
            : "text-t-primary hover:bg-[#eef0f2]",
        className
      )}
      {...props}
    >
      {Icon ? <Icon size={16} strokeWidth={1.9} /> : null}
      {showLabel && label ? <span className="whitespace-nowrap">{label}</span> : null}
      {children}
      {chevron ? <ChevronDown size={13} className="-mr-0.5 opacity-60" /> : null}
    </button>
  );
});

export function ToolDivider() {
  return <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-[#e3e5e8]" />;
}

interface ToolPopoverProps {
  /** Renders the trigger. `open` lets it show an active state; spread `triggerProps` onto a ToolButton. */
  trigger: (state: {
    open: boolean;
    triggerProps: {
      onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
      "aria-expanded": boolean;
      "aria-haspopup": "dialog" | "menu";
    };
  }) => ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  width?: number;
  align?: "start" | "center" | "end";
  role?: "dialog" | "menu";
  label: string;
}

/**
 * A popover anchored under its trigger.
 *
 * Positioned `fixed` from the trigger's rect because the contextual toolbar scrolls horizontally
 * on narrow screens, and an overflow scroller clips absolutely positioned children.
 */
export function ToolPopover({ trigger, children, width = 280, align = "center", role = "dialog", label }: ToolPopoverProps) {
  // The trigger element is kept with the anchor (not in a ref): it is only needed while open, to
  // tell a click on the trigger apart from a click outside.
  const [anchor, setAnchor] = useState<{ top: number; left: number; trigger: HTMLElement } | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const open = anchor !== null;

  const close = useCallback(() => setAnchor(null), []);
  const toggle = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      if (anchor) {
        setAnchor(null);
        return;
      }
      const node = event.currentTarget;
      const rect = node.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const preferredLeft =
        align === "start" ? rect.left : align === "end" ? rect.right - width : rect.left + rect.width / 2 - width / 2;
      const left = Math.max(8, Math.min(preferredLeft, viewportWidth - width - 8));
      setAnchor({ top: rect.bottom + 8, left, trigger: node });
    },
    [align, anchor, width]
  );

  useEffect(() => {
    if (!anchor) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target) || anchor.trigger.contains(target)) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", close);
    };
  }, [anchor, close]);

  return (
    <>
      {trigger({
        open,
        triggerProps: {
          onClick: toggle,
          "aria-expanded": open,
          "aria-haspopup": role,
        },
      })}
      {anchor ? (
        <div
          ref={panelRef}
          role={role}
          aria-label={label}
          className={cx("fixed z-[70] rounded-2xl bg-white p-3 text-t-primary", FLOATING_SHADOW)}
          style={{ top: anchor.top, left: anchor.left, width }}
        >
          {typeof children === "function" ? children(close) : children}
        </div>
      ) : null}
    </>
  );
}

interface MenuItemProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: IconComponent;
  tone?: "default" | "danger";
  hint?: ReactNode;
}

export function MenuItem({ icon: Icon, tone = "default", hint, className, children, ...props }: MenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      className={cx(
        "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13px] font-medium transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-40",
        tone === "danger" ? "text-[#c0362c] hover:bg-[#fdecea]" : "text-t-primary hover:bg-[#f1f2f4]",
        className
      )}
      {...props}
    >
      {Icon ? <Icon size={16} strokeWidth={1.9} className="shrink-0" /> : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint ? <span className="shrink-0 text-[11px] font-normal text-t-tertiary">{hint}</span> : null}
    </button>
  );
}

export function MenuSeparator() {
  return <div role="separator" className="my-1 h-px bg-[#eceef0]" />;
}

/** Title row of a popover: label on the left, an optional control (usually a switch) on the right. */
export function PopoverHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <span className="text-[13px] font-semibold text-t-primary">{title}</span>
      {children}
    </div>
  );
}

interface SliderFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  onChange: (value: number) => void;
  /** Shown to the right of the slider; defaults to the rounded value. */
  display?: ReactNode;
}

export function SliderField({ label, value, min, max, step = 1, disabled = false, onChange, display }: SliderFieldProps) {
  return (
    <label className={cx("block", disabled && "opacity-45")}>
      <span className="mb-1 flex items-center justify-between text-[12px] text-t-secondary">
        <span>{label}</span>
        <span className="tabular-nums text-t-primary">{display ?? Math.round(value)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={label}
        className="h-4 w-full cursor-pointer accent-[var(--brand-teal)] disabled:cursor-not-allowed"
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

/** Small on/off switch for popover headers. */
export function MiniSwitch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative h-5 w-9 shrink-0 rounded-full transition-colors",
        checked ? "bg-brand-teal" : "bg-[#d5d8dd]"
      )}
    >
      <span
        className={cx(
          "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-[left]",
          checked ? "left-[18px]" : "left-0.5"
        )}
      />
    </button>
  );
}
