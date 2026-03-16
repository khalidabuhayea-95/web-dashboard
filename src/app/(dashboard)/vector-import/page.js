import { requireRole, Roles } from "@/lib/auth/roles";

import VectorImportClient from "./VectorImportClient";

export default async function VectorImportPage() {
  await requireRole([Roles.ADMIN, Roles.EDITOR]);
  return <VectorImportClient />;
}
