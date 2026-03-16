import TemplatesClient from "./TemplatesClient";
import { requireRole, Roles } from "@/lib/auth/roles";

export default async function TemplatesPage() {
  await requireRole([Roles.ADMIN, Roles.EDITOR]);
  return <TemplatesClient />;
}
