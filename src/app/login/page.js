import Link from "next/link";

import { signIn, signUp } from "./actions";

export default async function LoginPage({ searchParams }) {
  const resolvedParams = await searchParams;
  const error = resolvedParams?.error;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">Sign in</h1>
          <p className="text-sm text-muted-foreground">
            Access your template workspace.
          </p>
        </div>

        {error ? (
          <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        ) : null}

        <form className="mt-6 space-y-4" action={signIn}>
          <div className="space-y-2">
            <label className="text-xs font-medium" htmlFor="email">
              Email
            </label>
            <input
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              id="email"
              name="email"
              type="email"
              placeholder="you@company.com"
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
              placeholder="••••••••"
              required
            />
          </div>

          <button className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            Sign in
          </button>
        </form>

        <form className="mt-3" action={signUp}>
          <button className="w-full rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground/80 hover:bg-accent">
            Create account
          </button>
        </form>

        <div className="mt-4 text-center text-xs text-muted-foreground">
          <Link className="hover:text-foreground" href="/">
            Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
