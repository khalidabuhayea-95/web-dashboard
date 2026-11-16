import UsersClient from "./UsersClient";
import { requireRole, Roles } from "@/lib/auth/roles";

export default async function UsersPage() {
  await requireRole([Roles.ADMIN]);
  return <UsersClient />;
}
