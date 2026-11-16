import { requireRole, Roles } from "@/lib/auth/roles";
import ContactMessagesClient from "./ContactMessagesClient";

// Auth-gated admin page; render on demand.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Contact messages",
  description: "Support inbox — messages sent from the website and the mobile app",
};

export default async function ContactMessagesPage() {
  await requireRole([Roles.ADMIN]);
  return <ContactMessagesClient />;
}
