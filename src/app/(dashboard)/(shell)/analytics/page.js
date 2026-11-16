import { requireRole, Roles } from "@/lib/auth/roles";

import AnalyticsClient from "./AnalyticsClient";

export default async function AnalyticsPage() {
  await requireRole([Roles.ADMIN]);

  return <AnalyticsClient />;
}
