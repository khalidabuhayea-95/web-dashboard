import { requireRole, Roles } from "@/lib/auth/roles";
import AiSettingsClient from "./AiSettingsClient";

export const metadata = {
  title: "AI settings",
  description: "Model routing and credit pricing for every AI feature",
};

export default async function AiSettingsPage() {
  await requireRole([Roles.ADMIN]);

  return <AiSettingsClient />;
}
