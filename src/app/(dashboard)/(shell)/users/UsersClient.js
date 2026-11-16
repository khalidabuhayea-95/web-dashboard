"use client";

import { useState } from "react";

import Button from "@/components/ui/button";

import DashboardUsersSection from "./DashboardUsersSection";
import MobileUsersSection from "./MobileUsersSection";

const TABS = [
  {
    value: "dashboard",
    label: "Dashboard users",
    description:
      "Manage dashboard access, invite designers, and protect the system admin account.",
  },
  {
    value: "mobile",
    label: "Mobile app users",
    description:
      "Browse and manage the accounts people sign in with from the mobile app.",
  },
];

export default function UsersClient() {
  const [tab, setTab] = useState("dashboard");
  const activeTab = TABS.find((entry) => entry.value === tab) ?? TABS[0];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Users</h1>
        <p className="text-sm text-muted-foreground">{activeTab.description}</p>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        {TABS.map((entry) => (
          <Button
            key={entry.value}
            type="button"
            variant={entry.value === tab ? "primary" : "ghost"}
            aria-pressed={entry.value === tab}
            onClick={() => setTab(entry.value)}
          >
            {entry.label}
          </Button>
        ))}
      </div>

      {tab === "mobile" ? <MobileUsersSection /> : <DashboardUsersSection />}
    </div>
  );
}
