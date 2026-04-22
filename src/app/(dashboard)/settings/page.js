import { requireRole, Roles } from "@/lib/auth/roles";

import SettingsWorkspaceClient from "./SettingsWorkspaceClient";

export const metadata = {
  title: "Settings",
  description: "Feature settings and credentials",
};

export default async function SettingsPage() {
  await requireRole([Roles.ADMIN, Roles.DESIGNER]);
  return <SettingsWorkspaceClient />;
}
