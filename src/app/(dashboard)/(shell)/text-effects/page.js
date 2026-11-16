import { requireRole, Roles } from "@/lib/auth/roles";
import TextEffectsClient from "./TextEffectsClient";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Text Effects",
  description: "Material styles applied to text layers in the editor and the app",
};

export default async function TextEffectsPage() {
  await requireRole([Roles.ADMIN]);
  return <TextEffectsClient />;
}
