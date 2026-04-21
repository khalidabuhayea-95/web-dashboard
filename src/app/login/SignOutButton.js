"use client";

import { useTransition } from "react";
import { signOut } from "next-auth/react";

import Button from "@/components/ui/button";

export default function SignOutButton() {
  const [pending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      await signOut({ callbackUrl: "/login" });
    });
  }

  return (
    <Button variant="secondary" type="button" disabled={pending} onClick={handleClick}>
      {pending ? "Signing out..." : "Sign out"}
    </Button>
  );
}
