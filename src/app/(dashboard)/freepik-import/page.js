import { requireRole, Roles } from "@/lib/auth/roles";

import FreepikImportClient from "./FreepikImportClient";

export default async function FreepikImportPage() {
  await requireRole([Roles.ADMIN, Roles.DESIGNER]);
  return <FreepikImportClient />;
}
