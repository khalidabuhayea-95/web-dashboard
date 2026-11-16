import { requireRole, Roles } from "@/lib/auth/roles";

import FreepikImportWorkspaceClient from "./FreepikImportWorkspaceClient";

export default async function FreepikImportPage() {
  await requireRole([Roles.ADMIN, Roles.DESIGNER]);
  return <FreepikImportWorkspaceClient />;
}
