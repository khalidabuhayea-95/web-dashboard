import { requireRole, Roles } from "@/lib/auth/roles";
import MagicToolsClient from "./MagicToolsClient";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Magic Tools",
  description: "One-tap image fixes for the mobile app",
};

export default async function MagicToolsPage() {
  await requireRole([Roles.ADMIN]);
  return <MagicToolsClient />;
}
