// Lets a dashboard page push a fresh count straight into its sidebar badge.
//
// DashboardNav polls for counts on an interval, which is right for work that
// happens elsewhere (a visitor sending a contact message). But when the page
// itself causes the change — opening a message flips it from "new" to "read" —
// waiting up to a poll interval to see the badge drop reads as a bug. The page
// already has the authoritative counts in the mutation response, so it hands
// them over directly and the badge updates in the same tick.

export const NAV_BADGE_EVENT = "dashboard:nav-badge";

/**
 * @param {string} href  nav item this belongs to, e.g. "/contact-messages"
 * @param {Record<string, number> | null | undefined} counts  status → count map
 */
export function publishNavBadge(href, counts) {
  if (typeof window === "undefined" || !href || !counts) return;
  window.dispatchEvent(new CustomEvent(NAV_BADGE_EVENT, { detail: { href, counts } }));
}
