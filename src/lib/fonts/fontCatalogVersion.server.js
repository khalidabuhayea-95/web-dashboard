import prisma from "@/lib/prisma";

// Monotonic counter bumped whenever the font catalog changes (add/update/delete/
// preview generation via any method). Mobile clients cache the full font list
// keyed by this version and only re-fetch when it changes. Stored as a bare
// jsonb number under a single AppSetting key.
const FONT_CATALOG_VERSION_KEY = "fonts_catalog_version";

export async function getFontCatalogVersion() {
  const row = await prisma.appSetting.findUnique({
    where: { key: FONT_CATALOG_VERSION_KEY },
    select: { value: true },
  });
  const value = Number(row?.value);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
}

// Atomic single-statement increment. Starts at 2 on first bump (the implicit
// initial version is 1 when the row is absent). A lost update under rare
// concurrent bumps is harmless — the version still changes, which is all the
// cache-invalidation contract requires.
export async function bumpFontCatalogVersion() {
  try {
    await prisma.$executeRaw`
      INSERT INTO "AppSetting" ("key", "value", "createdAt", "updatedAt")
      VALUES (${FONT_CATALOG_VERSION_KEY}, to_jsonb(2), now(), now())
      ON CONFLICT ("key") DO UPDATE
        SET "value" = to_jsonb(COALESCE(NULLIF("AppSetting"."value" #>> '{}', '')::int, 1) + 1),
            "updatedAt" = now()
    `;
  } catch (error) {
    // Never let a version bump failure break a font mutation; the next
    // successful mutation will advance the version.
    console.error("Failed to bump font catalog version", error);
  }
}
