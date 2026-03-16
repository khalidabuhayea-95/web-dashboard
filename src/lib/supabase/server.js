import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();
  const getAllCookies = () => {
    if (typeof cookieStore.getAll === "function") {
      return cookieStore.getAll();
    }
    if (typeof cookieStore[Symbol.iterator] === "function") {
      const results = [];
      for (const entry of cookieStore) {
        if (Array.isArray(entry)) {
          const [name, value] = entry;
          results.push({ name, value });
        } else if (entry?.name) {
          results.push(entry);
        }
      }
      return results;
    }
    return [];
  };

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return getAllCookies();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch (error) {
            // In a Server Component this will fail silently.
          }
        },
      },
    }
  );
}
