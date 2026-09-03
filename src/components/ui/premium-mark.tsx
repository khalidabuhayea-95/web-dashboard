import clsx from "clsx";
import { Crown } from "lucide-react";

interface PremiumMarkProps {
  /** Announced to screen readers, e.g. "Pro font". */
  label: string;
  className?: string;
}

/**
 * Read-only "this needs Nayroz Pro" marker for editor asset panels (fonts,
 * elements, backgrounds).
 *
 * Deliberately not interactive: pricing is set on the Fonts and Pro assets
 * pages, and the editor only reports it. Rendered as a coral disc so it reads
 * the same here as the crown the mobile app draws on the same assets.
 *
 * Render this only when the asset IS premium — a marker on every card would be
 * noise rather than a signal.
 */
export default function PremiumMark({ label, className }: PremiumMarkProps) {
  return (
    <span
      className={clsx(
        "inline-flex h-4 w-4 items-center justify-center rounded-full bg-[#e95e57] text-white shadow-sm",
        className
      )}
      title={label}
    >
      <Crown size={10} aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}
