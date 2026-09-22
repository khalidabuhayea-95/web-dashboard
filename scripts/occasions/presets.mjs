// The default occasions calendar — every Arabic and Islamic occasion the content team
// plans around. Seeded by scripts/seed-occasions.mjs; the dashboard is the source of
// truth afterwards (rows can be edited, disabled or deleted there, and the seed never
// resurrects a deleted slug without --create).
//
// Dates: `hijri` rows are Umm al-Qura month/day (resolved per year by
// src/lib/occasions/dates.ts and corrected by moon sighting through `dateOverrides` in
// the dashboard); `gregorian` rows are month/day, or a weekday rule
// ({ weekday: 0=Sun..6=Sat, weekOrdinal: 1..4 | -1 }).
//
// Lead days: `reminderLeadDays` is when the dashboard starts nagging, `boostLeadDays` is
// when linked content starts surfacing first in the app.

const KIND_DEFAULTS = {
  islamic: { color: "#0f766e", reminderLeadDays: 30, boostLeadDays: 14 },
  national: { color: "#1d4ed8", reminderLeadDays: 30, boostLeadDays: 14 },
  international: { color: "#7c3aed", reminderLeadDays: 21, boostLeadDays: 7 },
  seasonal: { color: "#ea580c", reminderLeadDays: 30, boostLeadDays: 14 },
};

function hijri(month, day, extra = {}) {
  return { calendar: "hijri", month, day, ...extra };
}

function gregorian(month, day, extra = {}) {
  return { calendar: "gregorian", month, day, ...extra };
}

function weekdayRule(month, weekday, weekOrdinal, extra = {}) {
  return { calendar: "gregorian", month, day: null, weekday, weekOrdinal, ...extra };
}

function define(kind, slug, titleEn, titleAr, rule, extra = {}) {
  const defaults = KIND_DEFAULTS[kind];
  return {
    slug,
    titleEn,
    titleAr,
    kind,
    calendar: rule.calendar,
    month: rule.month,
    day: rule.day ?? null,
    weekday: rule.weekday ?? null,
    weekOrdinal: rule.weekOrdinal ?? null,
    durationDays: rule.durationDays ?? 1,
    reminderLeadDays: extra.reminderLeadDays ?? defaults.reminderLeadDays,
    boostLeadDays: extra.boostLeadDays ?? defaults.boostLeadDays,
    countries: extra.countries ?? [],
    keywords: extra.keywords ?? [],
    notes: extra.notes ?? "",
    emoji: extra.emoji ?? "",
    color: extra.color ?? defaults.color,
    enabled: extra.enabled ?? true,
    boostEnabled: extra.boostEnabled ?? true,
    hoistCategories: extra.hoistCategories ?? true,
  };
}

const nationalDay = (country, slug, titleEn, titleAr, month, day, extra = {}) =>
  define("national", slug, titleEn, titleAr, gregorian(month, day, { durationDays: extra.durationDays ?? 1 }), {
    countries: [country],
    emoji: extra.emoji ?? "🎉",
    keywords: extra.keywords ?? [],
    notes: extra.notes ?? "",
    reminderLeadDays: extra.reminderLeadDays,
    boostLeadDays: extra.boostLeadDays,
  });

export const PRESETS = [
  // ---- Islamic (Hijri) --------------------------------------------------------------
  define("islamic", "hijri-new-year", "Hijri New Year", "رأس السنة الهجرية", hijri(1, 1), {
    emoji: "🌙",
    reminderLeadDays: 21,
    boostLeadDays: 10,
    keywords: ["هجرية", "السنة الهجرية", "hijri", "new year", "محرم"],
    notes: "عبارات: كل عام وأنتم بخير، سنة هجرية سعيدة. أفكار: هلال، تقويم، خط عربي.",
  }),
  define("islamic", "ashura", "Day of Ashura", "يوم عاشوراء", hijri(1, 10), {
    emoji: "🕌",
    reminderLeadDays: 14,
    boostLeadDays: 7,
    keywords: ["عاشوراء", "ashura", "صيام", "محرم"],
    notes: "صيام تاسوعاء وعاشوراء (9 و10 محرم). تذكير بفضل الصيام.",
  }),
  define("islamic", "mawlid", "Mawlid al-Nabi", "المولد النبوي الشريف", hijri(3, 12), {
    emoji: "🕌",
    reminderLeadDays: 21,
    boostLeadDays: 10,
    keywords: ["المولد النبوي", "مولد", "mawlid", "ربيع الأول"],
    notes: "عبارات: صلى الله عليه وسلم، اللهم صلِّ على محمد.",
  }),
  define("islamic", "isra-miraj", "Isra and Mi'raj", "الإسراء والمعراج", hijri(7, 27), {
    emoji: "✨",
    reminderLeadDays: 14,
    boostLeadDays: 7,
    keywords: ["الإسراء والمعراج", "isra", "miraj", "رجب", "المسجد الأقصى"],
  }),
  define("islamic", "shaban-15", "Mid-Sha'ban Night", "ليلة النصف من شعبان", hijri(8, 15), {
    emoji: "🌕",
    reminderLeadDays: 14,
    boostLeadDays: 7,
    keywords: ["النصف من شعبان", "شعبان", "shaban", "ليلة النصف"],
    notes: "بداية التجهيز لرمضان — عبارات: اللهم بلغنا رمضان.",
  }),
  define("islamic", "ramadan", "Ramadan", "شهر رمضان", hijri(9, 1, { durationDays: 30 }), {
    emoji: "🏮",
    reminderLeadDays: 60,
    boostLeadDays: 21,
    keywords: ["رمضان", "ramadan", "رمضان كريم", "إفطار", "سحور", "فانوس", "هلال"],
    notes:
      "عبارات: رمضان كريم، رمضان مبارك، اللهم بلغنا رمضان، كل عام وأنتم بخير. أفكار: دعوات إفطار، إمساكية، عروض رمضان، فوانيس وهلال.",
  }),
  define("islamic", "last-ten-nights", "Last Ten Nights & Laylat al-Qadr", "العشر الأواخر وليلة القدر", hijri(9, 21, { durationDays: 10 }), {
    emoji: "🌙",
    reminderLeadDays: 21,
    boostLeadDays: 7,
    keywords: ["ليلة القدر", "العشر الأواخر", "laylat al-qadr", "قيام", "اعتكاف"],
    notes: "عبارات: ليلة القدر خير من ألف شهر، اللهم إنك عفو تحب العفو فاعف عنا.",
  }),
  define("islamic", "eid-al-fitr", "Eid al-Fitr", "عيد الفطر", hijri(10, 1, { durationDays: 3 }), {
    emoji: "🎈",
    reminderLeadDays: 45,
    boostLeadDays: 21,
    keywords: ["عيد الفطر", "عيد", "eid", "eid al-fitr", "eid mubarak", "عيدية", "عيد مبارك"],
    notes:
      "عبارات: عيد مبارك، عيدكم مبارك، كل عام وأنتم بخير، عساكم من عواده. أفكار: بطاقات تهنئة، عيدية، تجهيزات العيد، حلويات.",
  }),
  define("islamic", "dhul-hijjah-ten", "First Ten Days of Dhu al-Hijjah", "العشر من ذي الحجة", hijri(12, 1, { durationDays: 10 }), {
    emoji: "🕋",
    reminderLeadDays: 21,
    boostLeadDays: 10,
    keywords: ["ذي الحجة", "العشر", "dhul hijjah", "تكبيرات", "الحج"],
    notes: "عبارات: الله أكبر ولله الحمد، أيام العشر. أفكار: تكبيرات، صيام، أضحية.",
  }),
  define("islamic", "hajj-season", "Hajj Season", "موسم الحج", hijri(12, 8, { durationDays: 6 }), {
    emoji: "🕋",
    reminderLeadDays: 30,
    boostLeadDays: 14,
    keywords: ["الحج", "حج", "hajj", "حج مبرور", "الكعبة", "عرفة"],
    notes: "عبارات: حج مبرور وسعي مشكور، لبيك اللهم لبيك.",
  }),
  define("islamic", "arafah", "Day of Arafah", "يوم عرفة", hijri(12, 9), {
    emoji: "⛰️",
    reminderLeadDays: 14,
    boostLeadDays: 7,
    keywords: ["عرفة", "يوم عرفة", "arafah", "صيام عرفة", "دعاء"],
    notes: "عبارات: لا إله إلا الله وحده لا شريك له، صيام يوم عرفة يكفر سنتين.",
  }),
  define("islamic", "eid-al-adha", "Eid al-Adha", "عيد الأضحى", hijri(12, 10, { durationDays: 4 }), {
    emoji: "🐑",
    reminderLeadDays: 45,
    boostLeadDays: 21,
    keywords: ["عيد الأضحى", "عيد", "eid", "eid al-adha", "أضحية", "عيد مبارك", "العيد الكبير"],
    notes:
      "عبارات: عيد أضحى مبارك، كل عام وأنتم بخير، عساكم من عواده. أفكار: بطاقات تهنئة، أضحية، حجاج، تكبيرات.",
  }),

  // ---- National days ------------------------------------------------------------------
  nationalDay("SA", "sa-founding-day", "Saudi Founding Day", "يوم التأسيس السعودي", 2, 22, {
    emoji: "🇸🇦",
    keywords: ["يوم التأسيس", "founding day", "التأسيس", "السعودية", "1727"],
    notes: "عبارات: يوم بدينا، يوم التأسيس. أفكار: البشت، النخلة، الخيل، الألوان التراثية.",
  }),
  nationalDay("SA", "sa-flag-day", "Saudi Flag Day", "يوم العلم السعودي", 3, 11, {
    emoji: "🇸🇦",
    keywords: ["يوم العلم", "flag day", "العلم السعودي", "السعودية"],
  }),
  nationalDay("SA", "sa-national-day", "Saudi National Day", "اليوم الوطني السعودي", 9, 23, {
    emoji: "🇸🇦",
    reminderLeadDays: 45,
    boostLeadDays: 21,
    keywords: ["اليوم الوطني", "national day", "السعودية", "23 سبتمبر", "دام عزك يا وطن", "وطني"],
    notes: "عبارات: دام عزك يا وطن، كل عام والوطن بخير، نحلم ونحقق. أفكار: أخضر، سيف ونخلة، ألعاب نارية.",
  }),
  nationalDay("AE", "ae-flag-day", "UAE Flag Day", "يوم العلم الإماراتي", 11, 3, {
    emoji: "🇦🇪",
    keywords: ["يوم العلم", "flag day", "الإمارات", "uae"],
  }),
  nationalDay("AE", "ae-commemoration-day", "UAE Commemoration Day", "يوم الشهيد الإماراتي", 11, 30, {
    emoji: "🇦🇪",
    keywords: ["يوم الشهيد", "commemoration day", "الإمارات", "uae"],
  }),
  nationalDay("AE", "ae-national-day", "UAE National Day (Eid Al Etihad)", "عيد الاتحاد الإماراتي", 12, 2, {
    emoji: "🇦🇪",
    durationDays: 2,
    reminderLeadDays: 45,
    boostLeadDays: 21,
    keywords: ["اليوم الوطني", "عيد الاتحاد", "national day", "الإمارات", "uae", "2 ديسمبر"],
    notes: "عبارات: عيد الاتحاد، روح الاتحاد، عام جديد من العزّ.",
  }),
  nationalDay("KW", "kw-national-day", "Kuwait National Day", "العيد الوطني الكويتي", 2, 25, {
    emoji: "🇰🇼",
    keywords: ["العيد الوطني", "national day", "الكويت", "kuwait", "25 فبراير"],
  }),
  nationalDay("KW", "kw-liberation-day", "Kuwait Liberation Day", "يوم التحرير الكويتي", 2, 26, {
    emoji: "🇰🇼",
    keywords: ["يوم التحرير", "liberation day", "الكويت", "kuwait", "26 فبراير"],
  }),
  nationalDay("QA", "qa-national-day", "Qatar National Day", "اليوم الوطني القطري", 12, 18, {
    emoji: "🇶🇦",
    keywords: ["اليوم الوطني", "national day", "قطر", "qatar", "18 ديسمبر"],
  }),
  define("national", "qa-sports-day", "Qatar National Sport Day", "اليوم الرياضي القطري", weekdayRule(2, 2, 2), {
    countries: ["QA"],
    emoji: "🏃",
    keywords: ["اليوم الرياضي", "sport day", "قطر", "qatar", "رياضة"],
  }),
  nationalDay("BH", "bh-national-day", "Bahrain National Day", "العيد الوطني البحريني", 12, 16, {
    emoji: "🇧🇭",
    durationDays: 2,
    keywords: ["العيد الوطني", "national day", "البحرين", "bahrain", "16 ديسمبر"],
  }),
  nationalDay("OM", "om-national-day", "Oman National Day", "العيد الوطني العماني", 11, 18, {
    emoji: "🇴🇲",
    keywords: ["العيد الوطني", "national day", "عمان", "oman", "18 نوفمبر"],
  }),
  nationalDay("JO", "jo-independence-day", "Jordan Independence Day", "عيد الاستقلال الأردني", 5, 25, {
    emoji: "🇯🇴",
    keywords: ["عيد الاستقلال", "independence day", "الأردن", "jordan", "25 أيار"],
  }),
  nationalDay("EG", "eg-revolution-day", "Egypt 23 July Revolution Day", "ثورة 23 يوليو", 7, 23, {
    emoji: "🇪🇬",
    keywords: ["23 يوليو", "revolution day", "مصر", "egypt"],
  }),
  nationalDay("EG", "eg-armed-forces-day", "Egypt Armed Forces Day", "عيد القوات المسلحة المصرية", 10, 6, {
    emoji: "🇪🇬",
    keywords: ["6 أكتوبر", "armed forces day", "مصر", "egypt", "نصر أكتوبر"],
  }),
  nationalDay("LB", "lb-independence-day", "Lebanon Independence Day", "عيد الاستقلال اللبناني", 11, 22, {
    emoji: "🇱🇧",
    keywords: ["عيد الاستقلال", "independence day", "لبنان", "lebanon"],
  }),
  nationalDay("SY", "sy-evacuation-day", "Syria Evacuation Day", "عيد الجلاء السوري", 4, 17, {
    emoji: "🇸🇾",
    keywords: ["عيد الجلاء", "evacuation day", "سوريا", "syria"],
  }),
  nationalDay("IQ", "iq-national-day", "Iraq National Day", "اليوم الوطني العراقي", 10, 3, {
    emoji: "🇮🇶",
    keywords: ["اليوم الوطني", "national day", "العراق", "iraq"],
  }),
  nationalDay("YE", "ye-unity-day", "Yemen Unity Day", "عيد الوحدة اليمنية", 5, 22, {
    emoji: "🇾🇪",
    keywords: ["عيد الوحدة", "unity day", "اليمن", "yemen"],
  }),
  define("international", "ps-solidarity-day", "International Day of Solidarity with the Palestinian People", "اليوم العالمي للتضامن مع الشعب الفلسطيني", gregorian(11, 29), {
    countries: ["PS"],
    emoji: "🇵🇸",
    keywords: ["فلسطين", "palestine", "التضامن", "القدس", "solidarity"],
  }),
  nationalDay("LY", "ly-independence-day", "Libya Independence Day", "عيد الاستقلال الليبي", 12, 24, {
    emoji: "🇱🇾",
    keywords: ["عيد الاستقلال", "independence day", "ليبيا", "libya"],
  }),
  nationalDay("TN", "tn-independence-day", "Tunisia Independence Day", "عيد الاستقلال التونسي", 3, 20, {
    emoji: "🇹🇳",
    keywords: ["عيد الاستقلال", "independence day", "تونس", "tunisia"],
  }),
  nationalDay("DZ", "dz-independence-day", "Algeria Independence Day", "عيد الاستقلال الجزائري", 7, 5, {
    emoji: "🇩🇿",
    keywords: ["عيد الاستقلال", "independence day", "الجزائر", "algeria"],
  }),
  nationalDay("DZ", "dz-revolution-day", "Algeria Revolution Day", "ذكرى ثورة أول نوفمبر", 11, 1, {
    emoji: "🇩🇿",
    keywords: ["أول نوفمبر", "revolution day", "الجزائر", "algeria"],
  }),
  nationalDay("MA", "ma-throne-day", "Morocco Throne Day", "عيد العرش المغربي", 7, 30, {
    emoji: "🇲🇦",
    keywords: ["عيد العرش", "throne day", "المغرب", "morocco"],
  }),
  nationalDay("MA", "ma-independence-day", "Morocco Independence Day", "عيد الاستقلال المغربي", 11, 18, {
    emoji: "🇲🇦",
    keywords: ["عيد الاستقلال", "independence day", "المغرب", "morocco"],
  }),
  nationalDay("SD", "sd-independence-day", "Sudan Independence Day", "عيد استقلال السودان", 1, 1, {
    emoji: "🇸🇩",
    keywords: ["عيد الاستقلال", "independence day", "السودان", "sudan"],
  }),
  nationalDay("MR", "mr-independence-day", "Mauritania Independence Day", "عيد استقلال موريتانيا", 11, 28, {
    emoji: "🇲🇷",
    keywords: ["عيد الاستقلال", "independence day", "موريتانيا", "mauritania"],
  }),
  nationalDay("SO", "so-independence-day", "Somalia Independence Day", "عيد استقلال الصومال", 7, 1, {
    emoji: "🇸🇴",
    keywords: ["عيد الاستقلال", "independence day", "الصومال", "somalia"],
  }),
  nationalDay("DJ", "dj-independence-day", "Djibouti Independence Day", "عيد استقلال جيبوتي", 6, 27, {
    emoji: "🇩🇯",
    keywords: ["عيد الاستقلال", "independence day", "جيبوتي", "djibouti"],
  }),
  nationalDay("KM", "km-independence-day", "Comoros Independence Day", "عيد استقلال جزر القمر", 7, 6, {
    emoji: "🇰🇲",
    keywords: ["عيد الاستقلال", "independence day", "جزر القمر", "comoros"],
  }),

  // ---- International / Arab days -------------------------------------------------------
  define("international", "new-year", "New Year's Day", "رأس السنة الميلادية", gregorian(1, 1), {
    emoji: "🎆",
    reminderLeadDays: 30,
    boostLeadDays: 14,
    keywords: ["رأس السنة", "السنة الجديدة", "new year", "happy new year", "2027"],
    notes: "عبارات: كل عام وأنتم بخير، سنة جديدة سعيدة. أفكار: ألعاب نارية، عد تنازلي، أهداف.",
  }),
  define("international", "valentines-day", "Valentine's Day", "عيد الحب", gregorian(2, 14), {
    emoji: "❤️",
    enabled: false,
    keywords: ["عيد الحب", "valentine", "حب", "ورد", "هدايا"],
    notes: "معطّل افتراضياً — فعّله إذا كان مناسباً لجمهورك (ورود، شوكولاتة، هدايا).",
  }),
  define("international", "teachers-day-arab", "Arab Teacher's Day", "يوم المعلم العربي", gregorian(2, 28), {
    emoji: "📚",
    keywords: ["يوم المعلم", "teacher's day", "معلم", "معلمة", "شكراً معلمي"],
  }),
  define("international", "womens-day", "International Women's Day", "اليوم العالمي للمرأة", gregorian(3, 8), {
    emoji: "👩",
    keywords: ["يوم المرأة", "women's day", "المرأة", "8 مارس"],
  }),
  define("international", "mothers-day", "Mother's Day", "عيد الأم", gregorian(3, 21), {
    emoji: "💐",
    reminderLeadDays: 30,
    boostLeadDays: 14,
    keywords: ["عيد الأم", "mother's day", "أمي", "ماما", "أم"],
    notes: "عبارات: كل عام وأنتِ بخير يا أمي، عيد أم سعيد، الله يخليك لنا. أفكار: ورود، هدايا، بطاقات.",
  }),
  define("international", "health-day", "World Health Day", "يوم الصحة العالمي", gregorian(4, 7), {
    emoji: "🩺",
    keywords: ["يوم الصحة", "health day", "صحة", "عيادة", "طبيب"],
  }),
  define("international", "earth-day", "Earth Day", "يوم الأرض العالمي", gregorian(4, 22), {
    emoji: "🌍",
    keywords: ["يوم الأرض", "earth day", "البيئة", "الأرض"],
  }),
  define("international", "labour-day", "Labour Day", "عيد العمال", gregorian(5, 1), {
    emoji: "👷",
    keywords: ["عيد العمال", "labour day", "عمال", "1 مايو"],
  }),
  define("international", "family-day", "International Day of Families", "اليوم العالمي للأسرة", gregorian(5, 15), {
    emoji: "👨‍👩‍👧",
    keywords: ["يوم الأسرة", "family day", "عائلة", "أسرة"],
  }),
  define("international", "environment-day", "World Environment Day", "يوم البيئة العالمي", gregorian(6, 5), {
    emoji: "🌱",
    keywords: ["يوم البيئة", "environment day", "البيئة", "تشجير"],
  }),
  define("international", "fathers-day", "Father's Day", "يوم الأب", gregorian(6, 21), {
    emoji: "👔",
    keywords: ["يوم الأب", "father's day", "أبي", "بابا", "أب"],
    notes: "عبارات: كل عام وأنت بخير يا أبي، شكراً أبي.",
  }),
  define("international", "youth-day", "International Youth Day", "اليوم العالمي للشباب", gregorian(8, 12), {
    emoji: "🧑",
    keywords: ["يوم الشباب", "youth day", "شباب"],
  }),
  define("international", "coffee-day", "International Coffee Day", "اليوم العالمي للقهوة", gregorian(10, 1), {
    emoji: "☕",
    keywords: ["يوم القهوة", "coffee day", "قهوة", "كافيه", "قهوة عربية"],
    notes: "مناسب لفئة المطاعم والمقاهي وعروض الكافيهات.",
  }),
  define("international", "teachers-day", "World Teachers' Day", "يوم المعلم العالمي", gregorian(10, 5), {
    emoji: "🍎",
    reminderLeadDays: 21,
    boostLeadDays: 10,
    keywords: ["يوم المعلم", "teachers day", "معلم", "معلمة", "شكراً معلمي", "مدرسة"],
    notes: "عبارات: شكراً معلمي، يوم المعلم، كل عام وأنت بخير يا معلمي.",
  }),
  define("international", "food-day", "World Food Day", "يوم الأغذية العالمي", gregorian(10, 16), {
    emoji: "🍽️",
    keywords: ["يوم الأغذية", "food day", "طعام", "مطعم"],
  }),
  define("international", "childrens-day", "World Children's Day", "اليوم العالمي للطفل", gregorian(11, 20), {
    emoji: "🧒",
    keywords: ["يوم الطفل", "children's day", "أطفال", "طفل"],
  }),
  define("international", "volunteer-day", "International Volunteer Day", "اليوم العالمي للتطوع", gregorian(12, 5), {
    emoji: "🤝",
    keywords: ["يوم التطوع", "volunteer day", "تطوع", "متطوع"],
  }),
  define("international", "arabic-language-day", "World Arabic Language Day", "اليوم العالمي للغة العربية", gregorian(12, 18), {
    emoji: "✍️",
    keywords: ["اللغة العربية", "arabic language day", "الضاد", "خط عربي", "لغتي"],
    notes: "أفكار: خط عربي، حروف، اقتباسات عن لغة الضاد.",
  }),

  // ---- Seasonal windows ---------------------------------------------------------------
  define("seasonal", "taif-rose-season", "Taif Rose Season", "موسم الورد الطائفي", gregorian(4, 1, { durationDays: 30 }), {
    countries: ["SA"],
    emoji: "🌹",
    keywords: ["الورد الطائفي", "الطائف", "taif rose", "ورد", "موسم الورد"],
  }),
  define("seasonal", "graduation-season", "Graduation Season", "موسم التخرج", gregorian(5, 20, { durationDays: 45 }), {
    emoji: "🎓",
    reminderLeadDays: 30,
    boostLeadDays: 14,
    keywords: ["تخرج", "graduation", "مبروك التخرج", "خريج", "خريجة", "الحمد لله على النجاح"],
    notes: "عبارات: مبروك التخرج، وتحقق ما كان بالأمس حلماً، تعبت وسهرت ونلت.",
  }),
  define("seasonal", "summer-vacation", "Summer Vacation", "إجازة الصيف", gregorian(6, 25, { durationDays: 60 }), {
    emoji: "🏖️",
    keywords: ["الصيف", "إجازة", "summer", "سفر", "بحر", "عطلة"],
  }),
  define("seasonal", "back-to-school", "Back to School", "العودة إلى المدارس", gregorian(8, 25, { durationDays: 14 }), {
    emoji: "🎒",
    reminderLeadDays: 30,
    boostLeadDays: 14,
    keywords: ["العودة للمدارس", "back to school", "مدرسة", "أول يوم دراسة", "طالب", "طالبة"],
    notes: "التاريخ يختلف كل عام حسب الدولة — عدّله من «التواريخ الفعلية». عبارات: أول يوم في المدرسة، سنة دراسية موفقة.",
  }),
  define("seasonal", "white-friday", "White Friday", "الجمعة البيضاء", weekdayRule(11, 5, -1, { durationDays: 3 }), {
    emoji: "🏷️",
    reminderLeadDays: 30,
    boostLeadDays: 14,
    keywords: ["الجمعة البيضاء", "white friday", "black friday", "عروض", "تخفيضات", "خصم"],
    notes: "لفئة المتاجر والعروض: خصومات، عروض محدودة، أسعار.",
  }),
  define("seasonal", "winter-camping", "Winter & Camping Season", "موسم الشتاء والتخييم", gregorian(12, 1, { durationDays: 60 }), {
    emoji: "🏕️",
    keywords: ["الشتاء", "تخييم", "كشتة", "winter", "camping", "بر"],
  }),
  define("seasonal", "year-end-offers", "Year-End Offers", "عروض نهاية العام", gregorian(12, 20, { durationDays: 12 }), {
    emoji: "🎁",
    keywords: ["نهاية العام", "year end", "عروض", "تخفيضات", "خصومات"],
  }),
];

const slugs = new Set();
for (const preset of PRESETS) {
  if (slugs.has(preset.slug)) throw new Error(`Duplicate occasion slug in presets: ${preset.slug}`);
  slugs.add(preset.slug);
}
