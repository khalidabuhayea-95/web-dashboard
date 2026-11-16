"use client";

import { useTransition } from "react";
import { signOut } from "next-auth/react";
import { LogOut } from "lucide-react";

import Button from "@/components/ui/button";

export default function SignOutButton() {
  const [pending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      await signOut({ callbackUrl: "/login" });
    });
  }

  return (
    <Button
      variant="secondary"
      type="button"
      disabled={pending}
      onClick={handleClick}
      className="inline-flex items-center gap-1.5"
    >
      <LogOut size={16} strokeWidth={2.25} aria-hidden="true" />
      {pending ? "Signing out..." : "Sign out"}
    </Button>
  );
}
