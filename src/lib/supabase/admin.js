import { createClient } from "@supabase/supabase-js";

let adminClient;

export function createAdminClient() {
  if (adminClient) {
    return adminClient;
  }

  adminClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
  );

  return adminClient;
}
