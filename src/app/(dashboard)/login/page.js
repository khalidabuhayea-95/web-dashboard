import Link from "next/link";

import { NayrozLockup } from "@/components/brand/NayrozLogo";

import LoginForm from "./LoginForm";

export const metadata = {
  title: "Sign in",
};

export default async function LoginPage({ searchParams }) {
  const resolvedParams = await searchParams;
  const error = String(resolvedParams?.error || "");
  const email = String(resolvedParams?.email || "");
  const registered =
    String(resolvedParams?.registered || "").trim() === "1";

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 py-10 text-foreground">
      <div className="w-full max-w-md">
        {/* The lockup sits above the card with its own clear space, rather than
            competing with the heading inside it. */}
        <div className="mb-8 flex justify-center">
          <NayrozLockup size={34} />
        </div>

        <div className="card p-6">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold">Sign in</h1>
            <p className="text-sm text-muted-foreground">Access your Nayroz Studio workspace.</p>
          </div>

          <LoginForm initialEmail={email} initialError={error} registered={registered} />

          <div className="alert mt-4">
            Dashboard access is invite-only. Use the registration link from an admin to create a
            designer account.
          </div>
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
