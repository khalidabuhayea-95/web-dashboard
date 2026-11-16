import EditorLayout from "@/components/editor/EditorLayout";
import { requireRole, Roles } from "@/lib/auth/roles";
import { buildDashboardNavItems } from "@/lib/dashboard/navItems.server";

export default async function EditorProPage() {
  const session = await requireRole([Roles.ADMIN, Roles.DESIGNER]);
  const navItems = await buildDashboardNavItems(session.role);
  // Designers author templates; only admins decide which ones cost money, so the
  // Pro toggle is hidden for them rather than shown and rejected on click.
  return <EditorLayout canManagePremium={session?.role === Roles.ADMIN} navItems={navItems} />;
}
