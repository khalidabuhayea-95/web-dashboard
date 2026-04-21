import { redirect } from "next/navigation";

import { auth } from "@/lib/auth/auth";
import { ensureSystemAdmin } from "@/lib/auth/dashboardUsers.server";
import { normalizeDashboardRole } from "@/lib/auth/utils";

export const Roles = {
  ADMIN: "admin",
  DESIGNER: "designer",
  EDITOR: "designer",
};

export async function getDashboardSession() {
  await ensureSystemAdmin();
  const session = await auth();
  const userId = String(session?.user?.id || "").trim();

  if (!userId) {
    return null;
  }

  return {
    userId,
    role: normalizeDashboardRole(session?.user?.role),
    user: {
      id: userId,
      email: String(session?.user?.email || ""),
      name: String(session?.user?.name || ""),
      isSystemAdmin: Boolean(session?.user?.isSystemAdmin),
    },
  };
}

export async function requireRole(allowedRoles = []) {
  const session = await getDashboardSession();

  if (!session) {
    redirect("/login");
  }

  if (allowedRoles.length > 0 && !allowedRoles.includes(session.role)) {
    redirect("/");
  }

  return session;
}
