import { requireRole, Roles } from "@/lib/auth/roles";
import SubscriptionsClient from "./SubscriptionsClient";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Subscriptions",
  description: "Package allowances, reference pricing and subscriber management for Nayroz Pro",
};

export default async function SubscriptionsPage() {
  await requireRole([Roles.ADMIN]);
  return <SubscriptionsClient />;
}
