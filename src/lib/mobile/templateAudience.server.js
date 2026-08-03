import { MOBILE_PRIVATE_NO_STORE } from "@/lib/mobile/cacheControl";
import { isMobileTester } from "@/lib/mobile/mobileUserRoles";
import { resolveOptionalMobileBearer } from "@/lib/mobile/userAuth.server";

// Decides which template statuses the caller of a public mobile endpoint may
// see. Everyone gets "published"; a signed-in tester account also gets "draft"
// so designers can review a template in the real app before publishing.
//
// Every mobile route that reads Template.status must build its filter from
// here rather than hard-coding `status: "published"` — that is what keeps the
// draft exposure to exactly one reviewed code path.

const PUBLISHED_ONLY = Object.freeze({ status: "published" });
const PUBLISHED_AND_DRAFT = Object.freeze({ status: { in: ["published", "draft"] } });

/**
 * @typedef {{
 *   isTester: boolean,
 *   viewerId: string | null,
 *   statusWhere: object,
 *   cacheControl: (publicValue: string) => string,
 *   headers: (publicValue: string) => Record<string, string>,
 * }} TemplateAudience
 *
 * @param {Request} request
 * @returns {Promise<TemplateAudience>}
 */
export async function resolveTemplateAudience(request) {
  // Anonymous callers, invalid tokens and disabled accounts all resolve to
  // null here, so they fall through to the published-only path.
  const viewer = await resolveOptionalMobileBearer(request);
  const tester = isMobileTester(viewer);

  return {
    isTester: tester,
    viewerId: viewer?.id || null,
    statusWhere: tester ? PUBLISHED_AND_DRAFT : PUBLISHED_ONLY,
    cacheControl: (publicValue) => (tester ? MOBILE_PRIVATE_NO_STORE : publicValue),
    headers: (publicValue) => ({
      "Cache-Control": tester ? MOBILE_PRIVATE_NO_STORE : publicValue,
      // The body now depends on the bearer token, so a shared cache must not
      // reuse one caller's response for another.
      Vary: "Authorization",
    }),
  };
}
