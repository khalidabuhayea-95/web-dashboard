import SettingsClient from "@/app/(dashboard)/settings/SettingsClient";
import { requireRole, Roles } from "@/lib/auth/roles";

export const metadata = {
  title: "Categories",
  description: "Template and background category settings",
};

export default async function CategoriesPage() {
  // Taxonomy is content, not configuration: both roles that reach this page can
  // edit it. The matching API routes apply the same rule.
  await requireRole([Roles.ADMIN, Roles.DESIGNER]);
  return <SettingsClient canEdit />;
}
