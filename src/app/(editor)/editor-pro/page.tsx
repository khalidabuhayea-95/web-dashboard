import EditorLayout from "@/components/editor/EditorLayout";
import { requireRole, Roles } from "@/lib/auth/roles";

export default async function EditorProPage() {
  await requireRole([Roles.ADMIN, Roles.EDITOR]);
  return <EditorLayout />;
}
