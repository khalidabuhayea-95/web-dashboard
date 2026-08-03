/**
 * Public share links for templates.
 *
 * A share link points at a PUBLISHED template by its public reference — either the
 * template uuid or its unique slug. Both resolve: `/api/mobile/templates/[slug]`
 * and the `/t/[ref]` landing page each accept uuid-or-slug.
 *
 * The origin is deliberately NOT `NEXT_PUBLIC_APP_URL` — that is `http://localhost:3000`
 * in development, and a share link must always be the real public origin so a link
 * generated from a dev dashboard is still openable by a recipient. Override with
 * `NEXT_PUBLIC_SHARE_ORIGIN` only when running a staging host that owns its own
 * assetlinks.json / apple-app-site-association pair.
 */

const DEFAULT_SHARE_ORIGIN = "https://nayroz.com";

/** Origin used to build share links. No trailing slash. */
export const SHARE_ORIGIN = String(
  process.env.NEXT_PUBLIC_SHARE_ORIGIN || DEFAULT_SHARE_ORIGIN
).replace(/\/+$/, "");

/** Path segment that both the app deep link and the web landing page listen on. */
export const SHARE_TEMPLATE_PATH = "t";

/**
 * Builds the canonical public share URL for a template.
 *
 * @param {string} ref Template uuid or slug.
 * @returns {string} e.g. `https://nayroz.com/t/summer-sale-poster`
 */
export function buildTemplateShareUrl(ref) {
  const trimmed = String(ref ?? "").trim();
  if (!trimmed) return "";
  return `${SHARE_ORIGIN}/${SHARE_TEMPLATE_PATH}/${encodeURIComponent(trimmed)}`;
}
