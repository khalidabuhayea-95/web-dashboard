import { redirect } from "next/navigation";

import DashboardNav from "@/app/(dashboard)/DashboardNav";
import { Roles } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";

export default async function EditorLayout({ children }) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims?.sub) {
    redirect("/login");
  }

  const role = data.claims.user_role || Roles.EDITOR;
  if (role !== Roles.ADMIN && role !== Roles.EDITOR) {
    redirect("/");
  }

  const navItems = [
    { href: "/", label: "Overview", icon: "overview" },
    { href: "/templates", label: "Templates", icon: "templates" },
    { href: "/settings", label: "Settings", icon: "settings" },
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
