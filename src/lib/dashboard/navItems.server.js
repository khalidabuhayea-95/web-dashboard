import { Roles } from "@/lib/auth/roles";
import { countOccasionReminders } from "@/lib/occasions/occasions.server";
import { countContactMessagesByStatus } from "@/lib/support/contactMessages.server";

/**
 * The sidebar nav, in one place.
 *
 * Both shells — the dashboard group and the editor group — render the same
 * `DashboardNav`, so they must feed it the same items. They used to hold a copy
 * each with a "keep in sync" comment, and the editor copy fell five entries
 * behind. Building the list here is what actually keeps them in sync.
 *
 * ★Since 2026-09-03 the list is two levels deep. An entry is either a page
 * (`{ href, label, icon }`) or a group (`{ key, label, icon, items }`) whose
 * pages sit underneath it and show when the group is opened. The flat list had
 * reached twenty rows, which is past what anyone scans; eight rows, each one
 * a question ("content? AI? people?"), is what the sidebar is for.
 *
 * Group `key`s are stable identifiers — the client remembers which groups a
 * user left open by key, so renaming a label must not change its key.
 *
 * Icon keys must exist in `DashboardNav`'s ICONS map, or the row falls back to
 * the Home glyph.
 */
export async function buildDashboardNavItems(role) {
  const isAdmin = role === Roles.ADMIN;

  // Server-rendered seed for the unread badge so it is correct on first paint;
  // DashboardNav then polls `countHref` to keep it live. Cosmetic only — a DB
  // hiccup here must not take down the whole shell.
  let unreadContactMessages = 0;
  if (isAdmin) {
    try {
      const counts = await countContactMessagesByStatus();
      unreadContactMessages = counts.new;
    } catch {
      unreadContactMessages = 0;
    }
  }

  // Occasions inside their reminder window with nothing linked yet. Every role sees this
  // badge — designers are the ones who make the templates the reminder is asking for.
  let occasionsNeedingContent = 0;
  try {
    occasionsNeedingContent = (await countOccasionReminders()).needsContent;
  } catch {
    occasionsNeedingContent = 0;
  }

  // Content management — everything a designer needs to produce templates.
  // Configuration, credentials, and people-management are admin-only; see the
  // page-level requireRole calls for the real gate.
  const content = [
    { href: "/templates", label: "Templates", icon: "templates" },
    { href: "/categories", label: "Categories", icon: "categories" },
    {
      href: "/occasions",
      label: "Occasions",
      icon: "occasions",
      badge: occasionsNeedingContent,
      badgeLabel: "occasions needing content",
      countHref: "/api/admin/occasions/count",
      countKey: "needsContent",
    },
  ];
  if (isAdmin) {
    content.push(
      { href: "/gallery", label: "Gallery", icon: "gallery" },
      { href: "/fonts", label: "Fonts", icon: "fonts" },
      { href: "/pro-assets", label: "Pro assets", icon: "proAssets" },
      { href: "/text-effects", label: "Text Effects", icon: "textEffects" }
    );
  }

  const navItems = [
    { href: "/", label: "Overview", icon: "overview" },
    { key: "content", label: "Content", icon: "content", items: content },
    {
      key: "import",
      label: "Import",
      icon: "import",
      items: [
        { href: "/freepik-import", label: "Freepik Import", icon: "freepikImport" },
        { href: "/psd-import", label: "PSD Import", icon: "psdImport" },
      ],
    },
    { href: "/editor-pro", label: "Editor", icon: "editor" },
  ];

  if (!isAdmin) return navItems;

  navItems.push(
    {
      key: "ai",
      label: "AI",
      icon: "ai",
      items: [
        { href: "/ai-settings", label: "AI settings", icon: "aiSettings" },
        { href: "/ai-templates", label: "AI Templates", icon: "aiTemplates" },
        { href: "/magic-tools", label: "Magic Tools", icon: "magicTools" },
      ],
    },
    {
      key: "settings",
      label: "Settings",
      icon: "settings",
      items: [
        // "General" rather than "Settings": inside a Settings group the old
        // label would read as the group repeating itself.
        { href: "/settings", label: "General", icon: "settings" },
        { href: "/mobile-settings", label: "Mobile app", icon: "mobileSettings" },
      ],
    },
    {
      key: "people",
      label: "People",
      icon: "people",
      items: [
        { href: "/users", label: "Users", icon: "users" },
        { href: "/subscriptions", label: "Subscriptions", icon: "subscriptions" },
      ],
    },
    {
      key: "engagement",
      label: "Engagement",
      icon: "engagement",
      items: [
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
        },
      ],
    }
  );

  return navItems;
}
