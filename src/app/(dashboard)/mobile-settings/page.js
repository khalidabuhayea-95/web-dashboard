import { requireRole, Roles } from "@/lib/auth/roles";

import { MobileAuthSettingsCard } from "../settings/FeatureSettingsClient";

export const metadata = {
  title: "Mobile settings",
  description: "Mobile app login and bearer-token settings",
};

export default async function MobileSettingsPage() {
  await requireRole([Roles.ADMIN, Roles.DESIGNER]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Mobile settings</h1>
        <p className="text-sm text-muted-foreground">
          Configure Google, Facebook, Apple, and bearer-token settings for the mobile app.
        </p>
      </div>

      <div className="max-w-4xl">
        <MobileAuthSettingsCard />
      </div>
    </div>
  );
}
