import { requireRole, Roles } from "@/lib/auth/roles";
import OccasionsClient from "./OccasionsClient";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Occasions",
  description: "Arabic and Islamic occasions calendar, reminders and seasonal content",
};

export default async function OccasionsPage() {
  const { role } = await requireRole([Roles.ADMIN, Roles.DESIGNER]);
  return <OccasionsClient role={role} />;
}
