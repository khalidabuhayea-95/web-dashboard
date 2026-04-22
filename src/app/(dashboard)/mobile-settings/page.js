import { requireRole, Roles } from "@/lib/auth/roles";
import MobileSettingsClient from "./MobileSettingsClient";

export const metadata = {
  title: "Mobile settings",
  description: "Mobile app behavior, login, and bearer-token settings",
};

export default async function MobileSettingsPage() {
  await requireRole([Roles.ADMIN, Roles.DESIGNER]);

  return <MobileSettingsClient />;
}
