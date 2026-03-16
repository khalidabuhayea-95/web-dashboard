import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export const Roles = {
  ADMIN: "admin",
  EDITOR: "editor",
};

export async function requireRole(allowedRoles = []) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims?.sub) {
    redirect("/login");
  }

  const role = data.claims.user_role || Roles.EDITOR;

  if (allowedRoles.length > 0 && !allowedRoles.includes(role)) {
    redirect("/");
  }

  return { role, userId: data.claims.sub };
}
