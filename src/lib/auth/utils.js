export function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

export function normalizeDashboardRole(value) {
  return String(value || "").trim().toLowerCase() === "admin" ? "admin" : "designer";
}

export function sanitizeDisplayName(value, fallback = "User") {
  const normalized = String(value || "").trim().replace(/\s+/g, " ");
  return normalized || fallback;
}
