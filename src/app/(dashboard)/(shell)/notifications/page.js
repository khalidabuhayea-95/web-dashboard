import { requireRole, Roles } from "@/lib/auth/roles";

import PushClient from "./PushClient";

export default async function NotificationsPage() {
  await requireRole([Roles.ADMIN]);

  return <PushClient />;
}
