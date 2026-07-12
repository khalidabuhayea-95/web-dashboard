import DashboardNav from "@/app/(dashboard)/DashboardNav";
import { requireRole, Roles } from "@/lib/auth/roles";

// Auth-gated editor pages (layout calls requireRole → DB). Render on demand.
export const dynamic = "force-dynamic";

export default async function EditorLayout({ children }) {
  const session = await requireRole([Roles.ADMIN, Roles.DESIGNER]);
  const role = session.role;

  const navItems = [
    { href: "/", label: "Overview", icon: "overview" },
    { href: "/templates", label: "Templates", icon: "templates" },
    { href: "/settings", label: "Settings", icon: "settings" },
    { href: "/mobile-settings", label: "Mobile settings", icon: "mobileSettings" },
    { href: "/categories", label: "Categories", icon: "categories" },
    { href: "/freepik-import", label: "Freepik Import", icon: "freepikImport" },
    { href: "/psd-import", label: "PSD Import", icon: "psdImport" },
    { href: "/editor-pro", label: "Editor", icon: "editor" },
  ];

  if (role === Roles.ADMIN) {
    navItems.push(
      { href: "/fonts", label: "Fonts", icon: "fonts" },
      { href: "/users", label: "Users", icon: "users" },
      { href: "/analytics", label: "Analytics", icon: "analytics" },
      { href: "/notifications", label: "Push", icon: "push" }
    );
  }

  return (
    <div className="app-shell editor-app-shell">
      <div className="flex min-h-screen">
        <aside className="sidebar hidden w-72 md:block">
          <div className="px-6 py-6">
            <div className="text-lg font-semibold">Studio Console</div>
            <div className="text-xs text-muted-foreground">
              Template operations hub
            </div>
          </div>
          <DashboardNav navItems={navItems} />
        </aside>

        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
