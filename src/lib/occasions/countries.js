// The Arab League states, for the occasion filters and the country picker. Codes are
// ISO-3166 alpha-2, which is also what the Occasion.countries column stores.
export const ARAB_COUNTRIES = [
  { code: "SA", en: "Saudi Arabia", ar: "السعودية" },
  { code: "AE", en: "United Arab Emirates", ar: "الإمارات" },
  { code: "KW", en: "Kuwait", ar: "الكويت" },
  { code: "QA", en: "Qatar", ar: "قطر" },
  { code: "BH", en: "Bahrain", ar: "البحرين" },
  { code: "OM", en: "Oman", ar: "عُمان" },
  { code: "JO", en: "Jordan", ar: "الأردن" },
  { code: "EG", en: "Egypt", ar: "مصر" },
  { code: "PS", en: "Palestine", ar: "فلسطين" },
  { code: "LB", en: "Lebanon", ar: "لبنان" },
  { code: "SY", en: "Syria", ar: "سوريا" },
  { code: "IQ", en: "Iraq", ar: "العراق" },
  { code: "YE", en: "Yemen", ar: "اليمن" },
  { code: "LY", en: "Libya", ar: "ليبيا" },
  { code: "TN", en: "Tunisia", ar: "تونس" },
  { code: "DZ", en: "Algeria", ar: "الجزائر" },
  { code: "MA", en: "Morocco", ar: "المغرب" },
  { code: "SD", en: "Sudan", ar: "السودان" },
  { code: "MR", en: "Mauritania", ar: "موريتانيا" },
  { code: "SO", en: "Somalia", ar: "الصومال" },
  { code: "DJ", en: "Djibouti", ar: "جيبوتي" },
  { code: "KM", en: "Comoros", ar: "جزر القمر" },
];

const BY_CODE = new Map(ARAB_COUNTRIES.map((country) => [country.code, country]));

/** 🇸🇦 from "SA" — regional-indicator pairs, no image assets needed. */
export function countryFlag(code) {
  const upper = String(code || "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(upper)) return "";
  return String.fromCodePoint(...[...upper].map((char) => 0x1f1e6 + char.charCodeAt(0) - 65));
}

export function countryName(code, locale = "en") {
  const entry = BY_CODE.get(String(code || "").toUpperCase());
  if (!entry) return String(code || "").toUpperCase();
  return locale === "ar" ? entry.ar : entry.en;
}
