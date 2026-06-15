import Button from "@/components/ui/button";
import SignOutButton from "@/app/login/SignOutButton";
import { requireRole, Roles } from "@/lib/auth/roles";
import DashboardNav from "@/app/(dashboard)/DashboardNav";

// Auth-gated, per-user pages (the layout calls requireRole → DB). They must be
// rendered on demand, never statically prerendered at build time.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Dashboard",
  description: "Template editor dashboard",
};

export default async function DashboardLayout({ children }) {
  const session = await requireRole([Roles.ADMIN, Roles.DESIGNER]);
  const role = session.role;
  const displayName = String(session.user?.name || session.user?.email || "User").trim() || "User";
  const displayEmail = String(session.user?.email || "").trim();
  const navItems = [
    { href: "/", label: "Overview", icon: "overview" },
    { href: "/templates", label: "Templates", icon: "templates" },
    { href: "/settings", label: "Settings", icon: "settings" },
    { href: "/mobile-settings", label: "Mobile settings", icon: "mobileSettings" },
    { href: "/categories", label: "Categories", icon: "categories" },
    { href: "/freepik-import", label: "Freepik Import", icon: "freepikImport" },
    { href: "/editor-pro", label: "Editor", icon: "editor" },
  ];

  if (role === Roles.ADMIN) {
    navItems.push(
      { href: "/users", label: "Users", icon: "users" },
      { href: "/analytics", label: "Analytics", icon: "analytics" },
      { href: "/notifications", label: "Push", icon: "push" }
    );
  }

  return (
    <div className="app-shell">
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

        <div className="flex w-full flex-col">
          <header className="topbar">
            <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4">
              <div className="min-w-0">
                <div className="truncate text-base font-semibold">{displayName}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {displayEmail || "No email"}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="badge">{role}</span>
                {role === Roles.ADMIN ? (
                  <Button as="a" variant="ghost" href="/notifications">
                    Send push
                  </Button>
                ) : null}
                <SignOutButton />
                <div className="h-9 w-9 rounded-full bg-muted" aria-hidden="true" />
              </div>
            </div>
          </header>

          <main className="w-full flex-1 px-0 py-6">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
