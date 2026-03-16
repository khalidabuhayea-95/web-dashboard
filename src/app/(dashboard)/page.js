import DashboardClient from "./DashboardClient";
import { requireRole } from "@/lib/auth/roles";

export default async function DashboardPage() {
  const { role } = await requireRole();
  return <DashboardClient role={role} />;
}
