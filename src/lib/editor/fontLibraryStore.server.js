import prisma from "@/lib/prisma";

const EDITOR_FONT_LIBRARY_KEY = "editor_font_library_v1";
const LEGACY_EDITOR_CUSTOM_FONTS_KEY = "editor_custom_fonts_v1";
const LEGACY_EDITOR_SYNCED_FONTS_KEY = "editor_synced_fonts_v1";

function normalizeLibraryPayload(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    version: Number(source.version) || 1,
    customFonts: source.customFonts ?? [],
    syncedFonts: source.syncedFonts ?? [],
    syncStatuses: source.syncStatuses && typeof source.syncStatuses === "object" ? source.syncStatuses : {},
    syncedAt: typeof source.syncedAt === "string" ? source.syncedAt : "",
  };
}

function buildLegacyFallback(customValue, syncedValue) {
  const syncedRecord = syncedValue && typeof syncedValue === "object" ? syncedValue : {};
  return normalizeLibraryPayload({
    version: 1,
    customFonts: customValue ?? [],
    syncedFonts: syncedRecord.fonts ?? [],
    syncStatuses: syncedRecord.statuses ?? {},
    syncedAt: typeof syncedRecord.syncedAt === "string" ? syncedRecord.syncedAt : "",
  });
}

export async function readEditorFontLibraryRaw() {
  try {
    const primary = await prisma.appSetting.findUnique({
      where: { key: EDITOR_FONT_LIBRARY_KEY },
      select: { value: true },
    });
    if (primary?.value) {
      return normalizeLibraryPayload(primary.value);
    }

    const legacyRecords = await prisma.appSetting.findMany({
      where: {
        key: {
          in: [LEGACY_EDITOR_CUSTOM_FONTS_KEY, LEGACY_EDITOR_SYNCED_FONTS_KEY],
        },
      },
      select: {
        key: true,
        value: true,
      },
    });

    const legacyMap = new Map(legacyRecords.map((record) => [record.key, record.value]));
    return buildLegacyFallback(
      legacyMap.get(LEGACY_EDITOR_CUSTOM_FONTS_KEY),
      legacyMap.get(LEGACY_EDITOR_SYNCED_FONTS_KEY)
    );
  } catch {
    return normalizeLibraryPayload({});
  }
}

export async function writeEditorFontLibraryRaw(value) {
  const payload = normalizeLibraryPayload(value);
  await prisma.appSetting.upsert({
    where: { key: EDITOR_FONT_LIBRARY_KEY },
    create: {
      key: EDITOR_FONT_LIBRARY_KEY,
      value: payload,
    },
    update: {
      value: payload,
    },
  });
  return payload;
}
