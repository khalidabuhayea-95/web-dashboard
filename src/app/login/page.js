import Link from "next/link";

import LoginForm from "./LoginForm";

export default async function LoginPage({ searchParams }) {
  const resolvedParams = await searchParams;
  const error = String(resolvedParams?.error || "");
  const email = String(resolvedParams?.email || "");
  const registered =
    String(resolvedParams?.registered || "").trim() === "1";

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">Sign in</h1>
          <p className="text-sm text-muted-foreground">
            Access your template workspace.
          </p>
        </div>

        <LoginForm initialEmail={email} initialError={error} registered={registered} />

        <div className="mt-3 rounded-md border border-border bg-muted/30 px-3 py-3 text-xs text-muted-foreground">
          Dashboard access is invite-only. Use the registration link from an admin to create a designer account.
        </div>

        <div className="mt-4 text-center text-xs text-muted-foreground">
          <Link className="hover:text-foreground" href="/">
            Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
