import { Roles } from "@/lib/auth/roles";
import { countContactMessagesByStatus } from "@/lib/support/contactMessages.server";

/**
 * The sidebar nav, in one place.
 *
 * Both shells — the dashboard group and the editor group — render the same
 * `DashboardNav`, so they must feed it the same items. They used to hold a copy
 * each with a "keep in sync" comment, and the editor copy fell five entries
 * behind. Building the list here is what actually keeps them in sync.
 *
 * Icon keys must exist in `DashboardNav`'s ICONS map, or the row falls back to
 * the Home glyph.
 */
export async function buildDashboardNavItems(role) {
  // Content management — everything a designer needs to produce templates.
  // Configuration, credentials, and people-management live behind the admin
  // block below; see the page-level requireRole calls for the real gate.
  const navItems = [
    { href: "/", label: "Overview", icon: "overview" },
    { href: "/templates", label: "Templates", icon: "templates" },
    { href: "/categories", label: "Categories", icon: "categories" },
    { href: "/freepik-import", label: "Freepik Import", icon: "freepikImport" },
    { href: "/psd-import", label: "PSD Import", icon: "psdImport" },
    { href: "/editor-pro", label: "Editor", icon: "editor" },
  ];

  if (role !== Roles.ADMIN) return navItems;

  // Server-rendered seed for the unread badge so it is correct on first paint;
  // DashboardNav then polls `countHref` to keep it live. Cosmetic only — a DB
  // hiccup here must not take down the whole shell.
  let unreadContactMessages = 0;
  try {
    const counts = await countContactMessagesByStatus();
    unreadContactMessages = counts.new;
  } catch {
    unreadContactMessages = 0;
  }

  navItems.push(
    { href: "/settings", label: "Settings", icon: "settings" },
    { href: "/mobile-settings", label: "Mobile settings", icon: "mobileSettings" },
    { href: "/ai-templates", label: "AI Templates", icon: "aiTemplates" },
    { href: "/magic-tools", label: "Magic Tools", icon: "magicTools" },
    { href: "/text-effects", label: "Text Effects", icon: "textEffects" },
    { href: "/gallery", label: "Gallery", icon: "gallery" },
    { href: "/fonts", label: "Fonts", icon: "fonts" },
    { href: "/users", label: "Users", icon: "users" },
    { href: "/analytics", label: "Analytics", icon: "analytics" },
    { href: "/notifications", label: "Push", icon: "push" },
    {
      href: "/contact-messages",
      label: "Contact messages",
      icon: "contactMessages",
      badge: unreadContactMessages,
      badgeLabel: "unread messages",
      countHref: "/api/admin/contact-messages/count",
      countKey: "new",
    }
  );

  return navItems;
}
