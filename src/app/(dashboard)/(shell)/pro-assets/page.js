import { requireRole, Roles } from "@/lib/auth/roles";
import ProAssetsClient from "./ProAssetsClient";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Pro assets",
  description: "Choose which elements and backgrounds require a Nayroz Pro subscription",
};

export default async function ProAssetsPage() {
  await requireRole([Roles.ADMIN]);
  return <ProAssetsClient />;
}
