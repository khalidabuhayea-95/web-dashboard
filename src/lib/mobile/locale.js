function parseLocaleCandidate(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  const first = raw.split(",")[0]?.split(";")[0]?.trim() || "";
  if (!first) return "";
  const base = first.split("-")[0]?.trim() || "";
  if (base === "ar") return "ar";
  if (base === "en") return "en";
  return "";
}

export function resolveMobileLocale(request, searchParams) {
  const headerCandidates = [
    request.headers.get("x-lang"),
    request.headers.get("lang"),
    request.headers.get("accept-language"),
  ];
  for (const candidate of headerCandidates) {
    const locale = parseLocaleCandidate(candidate);
    if (locale) return locale;
  }

  const queryCandidates = [searchParams?.get("lang"), searchParams?.get("locale")];
  for (const candidate of queryCandidates) {
    const locale = parseLocaleCandidate(candidate);
    if (locale) return locale;
  }

  return "en";
}
