import SettingsClient from "@/app/(dashboard)/settings/SettingsClient";
import { requireRole, Roles } from "@/lib/auth/roles";

export const metadata = {
  title: "Categories",
  description: "Template category settings",
};

export default async function CategoriesPage() {
  const { role } = await requireRole([Roles.ADMIN, Roles.EDITOR]);
  return <SettingsClient canEdit={role === Roles.ADMIN} />;
}
