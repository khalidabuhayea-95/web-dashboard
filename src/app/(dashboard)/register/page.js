import Link from "next/link";

import { NayrozLockup } from "@/components/brand/NayrozLogo";
import { getValidDashboardInvite } from "@/lib/auth/dashboardUsers.server";

import { registerDesigner } from "./actions";

export const metadata = {
  title: "Create designer account",
};

export default async function RegisterPage({ searchParams }) {
  const resolvedParams = await searchParams;
  const token = String(resolvedParams?.token || "");
  const error = String(resolvedParams?.error || "");
  const invite = token ? await getValidDashboardInvite(token) : null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 py-10 text-foreground">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <NayrozLockup size={34} />
        </div>

        <div className="card p-6">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold">Create designer account</h1>
            <p className="text-sm text-muted-foreground">
              Finish your Nayroz Studio invitation with your name, email, and password.
            </p>
          </div>

          {error ? <div className="alert alert-destructive mt-4">{error}</div> : null}

          {!invite ? (
            <div className="mt-6 space-y-3">
              <div className="alert">This invite is missing, expired, or already used.</div>
              <Link className="text-sm text-primary hover:underline" href="/login">
                Return to login
              </Link>
            </div>
          ) : (
            <form className="mt-6 space-y-4" action={registerDesigner}>
              <input type="hidden" name="token" value={token} />

              <div className="space-y-2">
                <label className="label block" htmlFor="name">
                  Name
                </label>
                <input
                  className="input"
                  id="name"
                  name="name"
                  type="text"
                  placeholder="Your name"
                  required
                />
              </div>

              <div className="space-y-2">
                <label className="label block" htmlFor="email">
                  Email
                </label>
                <input
                  className="input"
                  id="email"
                  name="email"
                  type="email"
                  defaultValue={invite.email}
                  required
                />
              </div>

              <div className="space-y-2">
                <label className="label block" htmlFor="password">
                  Password
                </label>
                <input
                  className="input"
                  id="password"
                  name="password"
                  type="password"
                  placeholder="At least 8 characters"
                  minLength={8}
                  required
                />
              </div>

              <button className="btn btn-primary w-full">Create designer account</button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
