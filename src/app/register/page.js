import Link from "next/link";

import { getValidDashboardInvite } from "@/lib/auth/dashboardUsers.server";

import { registerDesigner } from "./actions";

export default async function RegisterPage({ searchParams }) {
  const resolvedParams = await searchParams;
  const token = String(resolvedParams?.token || "");
  const error = String(resolvedParams?.error || "");
  const invite = token ? await getValidDashboardInvite(token) : null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">Create designer account</h1>
          <p className="text-sm text-muted-foreground">
            Finish your dashboard invitation with your name, email, and password.
          </p>
        </div>

        {error ? (
          <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        ) : null}

        {!invite ? (
          <div className="mt-6 space-y-3">
            <div className="rounded-md border border-border bg-muted/30 px-3 py-3 text-sm text-muted-foreground">
              This invite is missing, expired, or already used.
            </div>
            <Link className="text-sm text-primary hover:underline" href="/login">
              Return to login
            </Link>
          </div>
        ) : (
          <form className="mt-6 space-y-4" action={registerDesigner}>
            <input type="hidden" name="token" value={token} />

            <div className="space-y-2">
              <label className="text-xs font-medium" htmlFor="name">
                Name
              </label>
              <input
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                id="name"
                name="name"
                type="text"
                placeholder="Your name"
                required
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium" htmlFor="email">
                Email
              </label>
              <input
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                id="email"
                name="email"
                type="email"
                defaultValue={invite.email}
                required
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium" htmlFor="password">
                Password
              </label>
              <input
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                id="password"
                name="password"
                type="password"
                placeholder="At least 8 characters"
                minLength={8}
                required
              />
            </div>

            <button className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
              Create designer account
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
