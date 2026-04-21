"use server";

import { redirect } from "next/navigation";

import {
  getValidDashboardInvite,
  registerDashboardUserFromInvite,
} from "@/lib/auth/dashboardUsers.server";

function buildErrorRedirect(token, message) {
  const search = new URLSearchParams();
  if (token) {
    search.set("token", String(token));
  }
  search.set("error", message);
  return `/register?${search.toString()}`;
}

function buildSuccessRedirect(email) {
  const search = new URLSearchParams();
  search.set("registered", "1");
  search.set("email", String(email || ""));
  return `/login?${search.toString()}`;
}

export async function registerDesigner(formData) {
  const token = String(formData.get("token") || "");
  const name = String(formData.get("name") || "").trim();
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");

  if (!token) {
    redirect(buildErrorRedirect("", "Missing registration token."));
  }
  if (!name || !email || !password) {
    redirect(buildErrorRedirect(token, "Name, email, and password are required."));
  }
  if (password.length < 8) {
    redirect(buildErrorRedirect(token, "Password must be at least 8 characters."));
  }

  const invite = await getValidDashboardInvite(token);
  if (!invite) {
    redirect(buildErrorRedirect("", "This registration link is invalid or expired."));
  }

  try {
    await registerDashboardUserFromInvite({
      token,
      name,
      email,
      password,
    });
    redirect(buildSuccessRedirect(email));
  } catch (error) {
    redirect(buildErrorRedirect(token, error instanceof Error ? error.message : "Unable to create account."));
  }
}
