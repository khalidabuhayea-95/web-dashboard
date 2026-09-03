import clsx from "clsx";

/**
 * A two-state switch for settings that apply immediately — the Nayroz Pro flag
 * on a font, template or asset, for example.
 *
 * Built on a real checkbox input rather than a styled div so it keeps keyboard
 * focus, space-to-toggle and screen-reader semantics for free; the input itself
 * is visually hidden and the track/thumb are drawn by the sibling spans.
 *
 * Use this when the change saves on its own. A checkbox is still the right
 * control inside a form the user submits later.
 *
 * The JSDoc types are load-bearing: this is a .js component used from .tsx
 * callers, and without them TypeScript infers each prop from its default value
 * and rejects perfectly good usage.
 *
 * @typedef {object} SwitchOwnProps
 * @property {boolean} [checked]
 * @property {(next: boolean, event?: any) => void} [onChange]
 * @property {boolean} [disabled]
 * @property {import("react").ReactNode} [label]
 * @property {string} [labelClassName]
 * @property {string} [className]
 */
/**
 * Extra props (title, aria-*, data-*) pass straight to the underlying input.
 *
 * @param {SwitchOwnProps & Record<string, any>} props
 */
export default function Switch({
  checked = false,
  onChange,
  disabled = false,
  label,
  labelClassName,
  className,
  ...props
}) {
  return (
    <label
      className={clsx(
        "inline-flex items-center gap-2",
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
        className
      )}
    >
      <span className="relative inline-flex shrink-0">
        <input
          type="checkbox"
          role="switch"
          className="peer sr-only"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange?.(event.target.checked, event)}
          {...props}
        />
        <span
          aria-hidden="true"
          className={clsx(
            "block h-5 w-9 rounded-full transition-colors",
            "peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary",
            checked ? "bg-primary" : "bg-muted-foreground/35"
          )}
        />
        <span
          aria-hidden="true"
          className={clsx(
            "pointer-events-none absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform",
            checked && "translate-x-4"
          )}
        />
      </span>
      {label ? <span className={clsx("text-sm", labelClassName)}>{label}</span> : null}
    </label>
  );
}
