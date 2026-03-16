import { requireRole, Roles } from "@/lib/auth/roles";
import { Card, CardContent, CardHeader, CardSubtitle, CardTitle } from "@/components/ui/card";

export default async function AnalyticsPage() {
  await requireRole([Roles.ADMIN]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Analytics</h1>
        <p className="text-sm text-muted-foreground">
          Connect Google Analytics to surface usage trends.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Status</CardTitle>
          <CardSubtitle>Integration pending</CardSubtitle>
        </CardHeader>
        <CardContent>
          Add your GA Measurement ID when ready.
        </CardContent>
      </Card>
    </div>
  );
}
