// Ban semantics shared by the dashboard CRUD layer (mobileUsers.server.js) and
// the mobile auth path (userAuth.server.js). Kept dependency-free so either
// side can import it without pulling in the other.

// Indefinite bans store a far-future timestamp instead of a boolean so a
// timed ban can be added later without another migration. Mirrors how
// DashboardUser.bannedUntil is written in lib/auth/dashboardUsers.server.js.
export const INDEFINITE_BAN_UNTIL = new Date("9999-12-31T23:59:59.000Z");

export const ACCOUNT_DISABLED_CODE = "account_disabled";
export const ACCOUNT_DISABLED_MESSAGE =
  "This account has been disabled. Contact support if you think this is a mistake.";

// A ban that has run out counts as active again, so a timestamp written by
// hand (or by a future timed-ban feature) expires on its own.
export function isMobileUserBanned(user) {
  const bannedUntil = user?.bannedUntil;
  if (!bannedUntil) return false;
  return new Date(bannedUntil).getTime() > Date.now();
}

// Thrown from the auth path; `statusCode` is what lib/api/errors.handleApiError
// turns into the HTTP status, and `code` is the stable signal the app matches on.
export function accountDisabledError() {
  const error = new Error(ACCOUNT_DISABLED_MESSAGE);
  error.statusCode = 403;
  error.code = ACCOUNT_DISABLED_CODE;
  return error;
}
