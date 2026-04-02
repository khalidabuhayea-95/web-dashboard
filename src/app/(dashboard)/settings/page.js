import { requireRole, Roles } from "@/lib/auth/roles";

import FeatureSettingsClient from "./FeatureSettingsClient";

export const metadata = {
  title: "Settings",
  description: "Feature settings and credentials",
};

export default async function SettingsPage() {
  await requireRole([Roles.ADMIN, Roles.EDITOR]);
  return <FeatureSettingsClient />;
}
