import { requireRole, Roles } from "@/lib/auth/roles";
import DesignSystemClient from "./DesignSystemClient";

export default async function DesignSystemPage() {
  await requireRole([Roles.ADMIN]);
  return <DesignSystemClient />;
}
