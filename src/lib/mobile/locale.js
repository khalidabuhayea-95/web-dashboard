function parseLocaleCandidate(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  // A locale/Accept-Language value can list several ranges, e.g.
  // "fr-FR,ar-SA;q=0.9,en;q=0.8". Scan them in order and return the first
  // Arabic/English base we recognize. The region separator may be a hyphen
  // (iOS / BCP-47: "ar-SA") or an underscore (Android Locale.toString(): "ar_SA").
  for (const part of raw.split(",")) {
    const tag = part.split(";")[0]?.trim() || "";
    if (!tag) continue;
    const base = tag.split(/[-_]/)[0]?.trim() || "";
    if (base === "ar") return "ar";
    if (base === "en") return "en";
  }
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
