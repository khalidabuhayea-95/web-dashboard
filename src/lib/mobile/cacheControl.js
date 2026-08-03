export const MOBILE_PUBLIC_JSON_CACHE_SHORT =
  "public, max-age=300, stale-while-revalidate=600";

export const MOBILE_PUBLIC_JSON_CACHE_CATALOG =
  "public, max-age=600, stale-while-revalidate=1800";

// Used for any response whose body depends on who is asking — today that means
// a tester seeing unpublished templates. Such a body must never land in a
// shared cache where a normal user could be served it.
export const MOBILE_PRIVATE_NO_STORE = "private, no-store";
