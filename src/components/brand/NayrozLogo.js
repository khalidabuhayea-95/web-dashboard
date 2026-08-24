import clsx from "clsx";

/**
 * The Nayroz marks, straight from `public/brand` (the unmodified brand kit).
 *
 * The kit's rules are enforced here rather than left to each caller: the mark is
 * never recoloured or stretched, never rendered below 24px, and always keeps
 * clear space of at least half its width. Pick the tone that suits the ground —
 * `color` on light, `white` on dark or busy photography.
 */

// Native aspect ratios, from each file's viewBox. Height is the input everywhere
// because that is what lines up with adjacent type.
const MARK_RATIO = 149.404 / 148.962;
const LOCKUP_RATIO = {
  en: 357.434 / 148.962,
  ar: 294.499 / 148.962,
};

// "Minimum size 24 px on screen" — nayroz-brand-kit/README.txt.
const MIN_SIZE = 24;

const MARK_SRC = {
  color: "/brand/logo/nayroz-logo-color.svg",
  white: "/brand/logo/nayroz-logo-white.svg",
  "white-solid": "/brand/logo/nayroz-logo-white-solid.svg",
  black: "/brand/logo/nayroz-logo-black.svg",
};

const ICON_SRC = {
  rounded: "/brand/icon/nayroz-icon.svg",
  square: "/brand/icon/nayroz-icon-square.svg",
};

/** The mark on its own, transparent background. */
export function NayrozMark({ size = 32, tone = "color", className, title, ...props }) {
  const height = Math.max(MIN_SIZE, size);
  const width = Math.round(height * MARK_RATIO);

  return (
    // eslint-disable-next-line @next/next/no-img-element -- static brand vector; the optimizer has nothing to do with an SVG.
    <img
      src={MARK_SRC[tone] || MARK_SRC.color}
      alt={title || ""}
      aria-hidden={title ? undefined : "true"}
      width={width}
      height={height}
      className={clsx("brand-mark", className)}
      style={{ width, height }}
      {...props}
    />
  );
}

/** The app icon — the mark on the brand gradient, rounded or square. */
export function NayrozIcon({ size = 36, shape = "rounded", className, title, ...props }) {
  const box = Math.max(MIN_SIZE, size);

  return (
    // eslint-disable-next-line @next/next/no-img-element -- static brand vector; the optimizer has nothing to do with an SVG.
    <img
      src={ICON_SRC[shape] || ICON_SRC.rounded}
      alt={title || ""}
      aria-hidden={title ? undefined : "true"}
      width={box}
      height={box}
      className={clsx("brand-mark", className)}
      style={{ width: box, height: box }}
      {...props}
    />
  );
}

/**
 * Mark + wordmark. Arabic puts the mark on the right (reading order), Latin on
 * the left — that ordering is baked into the kit files, so `locale` picks a file
 * rather than flipping anything.
 */
export function NayrozLockup({
  size = 28,
  locale = "en",
  tone = "color",
  className,
  title = "Nayroz",
  ...props
}) {
  const script = locale === "ar" ? "ar" : "en";
  const variant = tone === "white" ? "white" : "color";
  const height = Math.max(MIN_SIZE, size);
  const width = Math.round(height * LOCKUP_RATIO[script]);

  return (
    // eslint-disable-next-line @next/next/no-img-element -- static brand vector; the optimizer has nothing to do with an SVG.
    <img
      src={`/brand/lockup/nayroz-lockup-${script}-${variant}.svg`}
      alt={title}
      width={width}
      height={height}
      className={clsx("brand-mark", className)}
      style={{ width, height }}
      {...props}
    />
  );
}

export default NayrozMark;
