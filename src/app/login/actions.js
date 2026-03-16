"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export async function signIn(formData) {
  const email = formData.get("email");
  const password = formData.get("password");

  if (!email || !password) {
    redirect("/login?error=Missing%20email%20or%20password");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }

  redirect("/");
}

export async function signUp(formData) {
  const email = formData.get("email");
  const password = formData.get("password");

  if (!email || !password) {
    redirect("/login?error=Missing%20email%20or%20password");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
  });

  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }

  redirect("/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
