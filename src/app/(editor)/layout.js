import Link from "next/link";

import DashboardNav from "@/app/(dashboard)/DashboardNav";
import { NayrozIcon } from "@/components/brand/NayrozLogo";
import { requireRole, Roles } from "@/lib/auth/roles";
import { buildDashboardNavItems } from "@/lib/dashboard/navItems.server";

// Auth-gated editor pages (layout calls requireRole → DB). Render on demand.
export const dynamic = "force-dynamic";

export default async function EditorLayout({ children }) {
  const session = await requireRole([Roles.ADMIN, Roles.DESIGNER]);
  const navItems = await buildDashboardNavItems(session.role);

  return (
    <div className="app-shell editor-app-shell">
      <div className="flex min-h-screen">
        <aside className="sidebar hidden w-72 md:block">
          {/* Same identity block as the dashboard group — one brand, one place. */}
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

        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
