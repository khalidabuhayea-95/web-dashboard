import { requireRole, Roles } from "@/lib/auth/roles";
import { Card, CardContent, CardHeader, CardSubtitle, CardTitle } from "@/components/ui/card";

export default async function NotificationsPage() {
  await requireRole([Roles.ADMIN]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Push Notifications</h1>
        <p className="text-sm text-muted-foreground">
          Configure Firebase Cloud Messaging for outbound pushes.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Status</CardTitle>
          <CardSubtitle>Integration pending</CardSubtitle>
        </CardHeader>
        <CardContent>
          Add Firebase config and VAPID key to enable notifications.
        </CardContent>
      </Card>
    </div>
  );
}
