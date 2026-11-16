import { requireRole, Roles } from "@/lib/auth/roles";
import AiTemplatesClient from "./AiTemplatesClient";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "AI Templates",
  description: "Prompt catalog for the mobile AI Tools tab",
};

export default async function AiTemplatesPage() {
  await requireRole([Roles.ADMIN]);
  return <AiTemplatesClient />;
}
