import { BellRing } from "lucide-react";

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
  const initials =
    displayName
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => word[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "U";
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
    <div className="app-shell">
      <div className="flex min-h-screen">
        <aside className="sidebar hidden w-72 md:sticky md:top-0 md:block md:h-screen md:self-start md:overflow-y-auto">
          <div className="px-6 py-6">
            <div className="text-lg font-semibold">Studio Console</div>
            <div className="text-xs text-muted-foreground">
              Template operations hub
            </div>
          </div>
          <DashboardNav navItems={navItems} />
        </aside>

        <div className="flex min-w-0 w-full flex-col">
          <header className="topbar sticky top-0 z-20">
            <div className="mx-auto flex w-full max-w-[1600px] items-center justify-between gap-4 px-6 py-4 lg:px-8">
              <div className="flex min-w-0 items-center gap-3">
                <div
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white shadow-sm"
                  style={{ background: "linear-gradient(135deg, var(--chart-1), var(--chart-3))" }}
                  aria-hidden="true"
                >
                  {initials}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold">{displayName}</span>
                    <span className="badge capitalize">{role}</span>
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {displayEmail || "No email"}
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {role === Roles.ADMIN ? (
                  <Button
                    as="a"
                    variant="ghost"
                    href="/notifications"
                    className="inline-flex items-center gap-1.5"
                  >
                    <BellRing size={16} strokeWidth={2.25} aria-hidden="true" />
                    <span className="hidden sm:inline">Send push</span>
                  </Button>
                ) : null}
                <SignOutButton />
              </div>
            </div>
          </header>

          <main className="mx-auto w-full max-w-[1600px] flex-1 px-6 py-6 lg:px-8 lg:py-8">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
