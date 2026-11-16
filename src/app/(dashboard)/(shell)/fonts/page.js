import { requireRole, Roles } from "@/lib/auth/roles";
import FontsClient from "./FontsClient";

// Auth-gated admin page; render on demand.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Fonts",
  description: "Font library management — import, upload, and organize fonts by language",
};

export default async function FontsPage() {
  await requireRole([Roles.ADMIN]);
  return <FontsClient />;
}
