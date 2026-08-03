// Mobile account roles, shared by the dashboard CRUD layer and the mobile API.
// Kept dependency-free so either side can import it.

export const MobileUserRoles = {
  // Normal app account: sees published templates only.
  USER: "user",
  // Review account: additionally sees templates whose status is still "draft",
  // so a designer can check a template in the real app before publishing it.
  TESTER: "tester",
};

export const MOBILE_USER_ROLE_VALUES = [MobileUserRoles.USER, MobileUserRoles.TESTER];

export function normalizeMobileUserRole(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === MobileUserRoles.TESTER ? MobileUserRoles.TESTER : MobileUserRoles.USER;
}

export function isMobileTester(user) {
  return normalizeMobileUserRole(user?.role) === MobileUserRoles.TESTER;
}
