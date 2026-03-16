import { requireRole, Roles } from "@/lib/auth/roles";

import CanvaImportClient from "./CanvaImportClient";

export default async function CanvaImportPage() {
  await requireRole([Roles.ADMIN, Roles.EDITOR]);
  return <CanvaImportClient />;
}

