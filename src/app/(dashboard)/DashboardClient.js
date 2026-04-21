"use client";

import { useEffect, useState } from "react";

import Button from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardSubtitle, CardTitle } from "@/components/ui/card";

export default function DashboardClient({ role }) {
  const [stats, setStats] = useState(null);
  const [status, setStatus] = useState("");

  useEffect(() => {
    let isMounted = true;

    if (role !== "admin") {
      return undefined;
    }

    const loadStats = async () => {
      setStatus("Loading stats...");
      try {
        const response = await fetch("/api/admin/stats");
        if (!response.ok) {
          const payload = await response.json();
          throw new Error(payload?.error || "Failed to load stats.");
        }
        const payload = await response.json();
        if (isMounted) {
          setStats(payload);
          setStatus("");
        }
      } catch (error) {
        if (isMounted) {
          setStatus(error.message || "Failed to load stats.");
        }
      }
    };

    loadStats();

    return () => {
      isMounted = false;
    };
  }, [role]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardSubtitle>Overview</CardSubtitle>
          <CardTitle>Workspace pulse</CardTitle>
          <div className="mt-2 text-sm text-muted-foreground">
            {role === "admin"
              ? "Monitor growth, analytics, and operational health."
              : "Ship new templates and keep the library current."}
          </div>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button as="a" href="/templates" variant="secondary">
            View templates
          </Button>
          <Button as="a" href="/editor-pro">
            Open Editor
          </Button>
        </CardContent>
      </Card>

      {role === "admin" ? (
        <div className="space-y-4">
          {status ? (
            <div className="text-sm text-muted-foreground">{status}</div>
          ) : null}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "Total users", value: stats?.totalUsers ?? "-" },
              { label: "Total templates", value: stats?.totalTemplates ?? "-" },
              {
                label: "Templates last 7 days",
                value: stats?.templatesLast7Days ?? "-",
              },
              { label: "Active designers", value: stats?.activeEditors ?? "-" },
              {
                label: `Imports (${stats?.importJobs?.lookbackHours ?? 24}h)`,
                value: stats?.importJobs?.lookbackCount ?? "-",
              },
              {
                label: `Import failures (${stats?.importJobs?.lookbackHours ?? 24}h)`,
                value: stats?.importJobs?.lookbackFailedCount ?? "-",
              },
              { label: "Import queue pending", value: stats?.importJobs?.pending ?? "-" },
              { label: "Import queue running", value: stats?.importJobs?.running ?? "-" },
            ].map((item) => (
              <Card key={item.label}>
                <CardContent>
                  <div className="text-xs text-muted-foreground">
                    {item.label}
                  </div>
                  <div className="mt-2 text-2xl font-semibold">{item.value}</div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardContent>
              <div className="text-xs text-muted-foreground">Templates</div>
              <div className="mt-2 text-lg font-semibold">
                Keep templates current
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                Review existing templates and keep them aligned with brand
                needs.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <div className="text-xs text-muted-foreground">Editor</div>
              <div className="mt-2 text-lg font-semibold">
                Build new templates
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                Use Editor to draft new layouts for your teams.
              </p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
