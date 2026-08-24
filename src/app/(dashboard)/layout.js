import Link from "next/link";
import { BellRing } from "lucide-react";

import Button from "@/components/ui/button";
import { NayrozIcon } from "@/components/brand/NayrozLogo";
import SignOutButton from "@/app/login/SignOutButton";
import { requireRole, Roles } from "@/lib/auth/roles";
import { buildDashboardNavItems } from "@/lib/dashboard/navItems.server";
import DashboardNav from "@/app/(dashboard)/DashboardNav";

// Auth-gated, per-user pages (the layout calls requireRole → DB). They must be
// rendered on demand, never statically prerendered at build time.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Dashboard",
  description: "Nayroz Studio — templates, fonts, and mobile app operations.",
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
  const navItems = await buildDashboardNavItems(role);

  return (
    <div className="app-shell">
      <div className="flex min-h-screen">
        <aside className="sidebar hidden w-72 md:sticky md:top-0 md:block md:h-screen md:self-start md:overflow-y-auto">
          {/* Workspace identity block, styled like the reference's switcher —
              now carrying the Nayroz app icon rather than a letter tile. */}
          <Link
            href="/"
            className="flex items-center gap-3 px-6 py-5 transition-opacity hover:opacity-80"
          >
            <NayrozIcon size={36} />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">Nayroz</div>
              <div className="truncate text-xs text-muted-foreground">Studio console</div>
            </div>
          </Link>
          <DashboardNav navItems={navItems} />
        </aside>

        <div className="flex min-w-0 w-full flex-col">
          <header className="topbar sticky top-0 z-20">
            <div className="mx-auto flex w-full max-w-[1600px] items-center justify-between gap-4 px-6 py-4 lg:px-8">
              <div className="flex min-w-0 items-center gap-3">
                <div
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--ds-surface)] text-sm font-semibold text-[var(--ds-text)]"
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
