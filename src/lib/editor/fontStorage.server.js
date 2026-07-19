import prisma from "@/lib/prisma";
import { deriveReadableFontLabel } from "@/lib/editor/customFontLabel";
import { bumpFontCatalogVersion } from "@/lib/fonts/fontCatalogVersion.server";

export const FONT_SOURCE_CUSTOM = "custom";
export const FONT_STATUS_READY = "ready";
export const FONT_STATUS_PENDING = "pending";
export const FONT_STATUS_FAILED = "failed";
export const FONT_FILE_KIND_ORIGINAL = "original";
export const FONT_FILE_KIND_MOBILE = "mobile";

const MOBILE_SUPPORTED_FONT_FORMATS = new Set(["ttf", "otf", "ttc"]);
const FONT_CATEGORY_EXCLUSIVE = "EXCLUSIVE";
const FONT_CATEGORY_ENGLISH = "ENGLISH";
const FONT_CATEGORY_ARABIC = "ARABIC";
const ALLOWED_FONT_CATEGORIES = new Set([
  FONT_CATEGORY_EXCLUSIVE,
  FONT_CATEGORY_ENGLISH,
  FONT_CATEGORY_ARABIC,
]);

function containsArabicScript(value) {
  return /[\u0600-\u06FF]/.test(String(value || ""));
}

export function normalizeFontStorageKey(value) {
  return String(value || "")
    .trim()
    .replace(/^['"]+|['"]+$/g, "")
    .replace(/[_\s-]+/g, "")
    .toLowerCase();
}

export function normalizeFontCategories(value, fallbackSample = "") {
  const categories = Array.isArray(value)
    ? value
        .map((item) => String(item || "").trim().toUpperCase())
        .filter((item) => ALLOWED_FONT_CATEGORIES.has(item))
    : [];
  if (!categories.includes(FONT_CATEGORY_EXCLUSIVE)) {
    categories.unshift(FONT_CATEGORY_EXCLUSIVE);
  }
  if (!categories.includes(FONT_CATEGORY_ARABIC) && !categories.includes(FONT_CATEGORY_ENGLISH)) {
    categories.push(
      containsArabicScript(fallbackSample)
        ? FONT_CATEGORY_ARABIC
        : FONT_CATEGORY_ENGLISH
    );
  }
  return Array.from(new Set(categories));
}

function normalizeSource(value) {
  return String(value || FONT_SOURCE_CUSTOM).trim().toLowerCase() || FONT_SOURCE_CUSTOM;
}

function normalizeStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  if (status === FONT_STATUS_PENDING || status === FONT_STATUS_FAILED) return status;
  return FONT_STATUS_READY;
}

function normalizeFileKind(value) {
  const kind = String(value || "").trim().toLowerCase();
  if (kind === FONT_FILE_KIND_MOBILE) return FONT_FILE_KIND_MOBILE;
  return FONT_FILE_KIND_ORIGINAL;
}

function normalizeFontFileInput(file) {
  if (!file || typeof file !== "object") return null;
  const kind = normalizeFileKind(file.kind);
  const format = String(file.format || "").trim().toLowerCase() || "unknown";
  const mimeType = String(file.mimeType || "").trim().toLowerCase() || "application/octet-stream";
  const publicUrl = String(file.publicUrl || file.fileUrl || "").trim();
  const storageBucket = String(file.storageBucket || file.bucket || "").trim();
  const storagePath = String(file.storagePath || file.path || "").trim();
  if (!publicUrl && !storagePath) return null;
  return {
    kind,
    format,
    mimeType,
    fileName: String(file.fileName || "").trim() || null,
    storageBucket: storageBucket || null,
    storagePath: storagePath || null,
    publicUrl: publicUrl || null,
    sizeBytes: Number.isFinite(Number(file.sizeBytes))
      ? Math.max(0, Math.round(Number(file.sizeBytes)))
      : null,
    checksum: String(file.checksum || "").trim() || null,
    status: normalizeStatus(file.status),
  };
}

function normalizeAliasInputs({ family, displayName, aliases }) {
  const values = [
    family,
    displayName,
    String(family || "").replace(/_/g, " "),
    ...(Array.isArray(aliases) ? aliases : []),
  ];
  const seen = new Set();
  return values
    .map((alias) => String(alias || "").trim())
    .filter((alias) => {
      const key = normalizeFontStorageKey(alias);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((alias) => ({
      alias,
      normalizedAlias: normalizeFontStorageKey(alias),
    }));
}

function withFontIncludes(font) {
  return font && typeof font === "object" ? font : null;
}

export function resolvePreferredFontFile(font, preferredKind = FONT_FILE_KIND_MOBILE) {
  const files = Array.isArray(font?.files) ? font.files : [];
  const preferred = files.find(
    (file) =>
      String(file?.kind || "").toLowerCase() === preferredKind &&
      String(file?.status || FONT_STATUS_READY).toLowerCase() === FONT_STATUS_READY
  );
  if (preferred) return preferred;
  return (
    files.find(
      (file) =>
        String(file?.kind || "").toLowerCase() === FONT_FILE_KIND_ORIGINAL &&
        String(file?.status || FONT_STATUS_READY).toLowerCase() === FONT_STATUS_READY
    ) || null
  );
}

export function isMobileCompatibleFontFile(file) {
  return MOBILE_SUPPORTED_FONT_FORMATS.has(String(file?.format || "").trim().toLowerCase());
}

export function toEditorFontRecord(font) {
  const record = withFontIncludes(font);
  if (!record) return null;
  const source = normalizeSource(record.source);
  const preferredFile = resolvePreferredFontFile(record);
  const originalFile = resolvePreferredFontFile(record, FONT_FILE_KIND_ORIGINAL) || preferredFile;
  const routeUrl = record.id ? `/api/mobile/fonts/${encodeURIComponent(record.id)}/file` : "";
  return {
    id: String(record.id || ""),
    family: String(record.family || "").trim(),
    fileName: String(preferredFile?.fileName || originalFile?.fileName || "").trim(),
    mimeType: String(preferredFile?.mimeType || originalFile?.mimeType || "").trim(),
    fileUrl: routeUrl || String(preferredFile?.publicUrl || originalFile?.publicUrl || "").trim(),
    dataUrl: undefined,
    displayName:
      String(record.displayName || "").trim() ||
      deriveReadableFontLabel({ family: record.family }),
    categories: normalizeFontCategories(record.categories, record.family),
    source,
    sourceLabel: source === FONT_SOURCE_CUSTOM ? "Custom" : source,
    removable: record.removable !== false && source === FONT_SOURCE_CUSTOM,
    conversionStatus: String(record.conversionStatus || record.status || FONT_STATUS_READY),
    conversionError: String(record.conversionError || "").trim(),
    conversionAttempts: Number(record.conversionAttempts) || 0,
    lastConversionAt: record.lastConversionAt || null,
    mobileCompatible: isMobileCompatibleFontFile(preferredFile),
    previewImageUrl: String(record.previewImageUrl || "").trim() || null,
    previewImageDarkUrl: String(record.previewImageDarkUrl || "").trim() || null,
    previewImageUpdatedAt: record.previewImageUpdatedAt || null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function toMobileFontRecord(request, font) {
  const record = withFontIncludes(font);
  if (!record) return null;
  const preferredFile = resolvePreferredFontFile(record);
  const mobileCompatible = isMobileCompatibleFontFile(preferredFile);
  const routeUrl =
    record.id && request?.url
      ? new URL(`/api/mobile/fonts/${encodeURIComponent(record.id)}/file`, request.url).toString()
      : record.id
        ? `/api/mobile/fonts/${encodeURIComponent(record.id)}/file`
        : "";
  const displayName =
    String(record.displayName || "").trim() ||
    deriveReadableFontLabel({ family: record.family });
  const categories = normalizeFontCategories(record.categories, record.family);
  // Arabic-vs-English sample is chosen by the font's script support (categories),
  // not its name — most Arabic fonts have Latin names (Rubik, Cairo, …).
  const isArabicFont = categories.includes("ARABIC") || containsArabicScript(displayName);
  return {
    id: String(record.id || ""),
    fontName: String(record.family || "").trim(),
    displayName,
    previewText:
      String(record.previewText || "").trim() ||
      (isArabicFont ? "أبجد هوز حطي" : "The quick brown fox"),
    categories,
    previewWeight: Number(record.previewWeight) || 400,
    cssFontFamily: String(record.cssFontFamily || "").trim() || `'${record.family}'`,
    previewImage:
      record.previewImageUrl || record.previewImageDarkUrl
        ? {
            light: String(record.previewImageUrl || "").trim() || null,
            dark: String(record.previewImageDarkUrl || "").trim() || null,
            updatedAt: record.previewImageUpdatedAt || null,
          }
        : null,
    downloadUrl: mobileCompatible ? routeUrl : null,
    mobileDownloadUrl: mobileCompatible ? routeUrl : null,
    mobileCompatible,
    fontFormat: String(preferredFile?.format || "unknown").trim().toLowerCase(),
    sourceMimeType: String(preferredFile?.mimeType || "").trim().toLowerCase() || null,
    source: String(record.source || FONT_SOURCE_CUSTOM).trim() || FONT_SOURCE_CUSTOM,
    isNew: false,
  };
}

export async function listFontFamilies({ source, excludeSource, search, skip = 0, take } = {}) {
  const where = {};
  if (source) {
    where.source = normalizeSource(source);
  }
  if (excludeSource) {
    where.source = { not: normalizeSource(excludeSource) };
  }
  const normalizedSearch = String(search || "").trim();
  if (normalizedSearch) {
    where.OR = [
      { family: { contains: normalizedSearch, mode: "insensitive" } },
      { displayName: { contains: normalizedSearch, mode: "insensitive" } },
    ];
  }

  return prisma.fontFamily.findMany({
    where,
    include: {
      files: true,
      aliases: true,
    },
    orderBy: [{ displayName: "asc" }, { family: "asc" }],
    skip: Math.max(0, Number(skip) || 0),
    ...(Number.isFinite(Number(take)) ? { take: Math.max(1, Math.round(Number(take))) } : {}),
  });
}

export async function countFontFamilies({ source, excludeSource, search } = {}) {
  const where = {};
  if (source) {
    where.source = normalizeSource(source);
  }
  if (excludeSource) {
    where.source = { not: normalizeSource(excludeSource) };
  }
  const normalizedSearch = String(search || "").trim();
  if (normalizedSearch) {
    where.OR = [
      { family: { contains: normalizedSearch, mode: "insensitive" } },
      { displayName: { contains: normalizedSearch, mode: "insensitive" } },
    ];
  }
  return prisma.fontFamily.count({ where });
}

export async function getFontFamilyById(id) {
  const fontId = String(id || "").trim();
  if (!fontId) return null;
  return prisma.fontFamily.findUnique({
    where: { id: fontId },
    include: {
      files: true,
      aliases: true,
    },
  });
}

export async function getFontFamilyByNormalizedFamily(value) {
  const normalizedFamily = normalizeFontStorageKey(value);
  if (!normalizedFamily) return null;
  return prisma.fontFamily.findUnique({
    where: { normalizedFamily },
    include: {
      files: true,
      aliases: true,
    },
  });
}

export async function findFontFamiliesByNames(fontNames = []) {
  const requestedKeys = Array.from(
    new Set(
      (Array.isArray(fontNames) ? fontNames : [])
        .map((value) => normalizeFontStorageKey(value))
        .filter(Boolean)
    )
  );
  if (requestedKeys.length === 0) return new Map();

  const aliases = await prisma.fontAlias.findMany({
    where: {
      normalizedAlias: {
        in: requestedKeys,
      },
    },
    include: {
      font: {
        include: {
          files: true,
          aliases: true,
        },
      },
    },
  });

  const lookup = new Map();
  aliases.forEach((alias) => {
    if (!alias?.font) return;
    const key = String(alias.normalizedAlias || "").trim();
    if (!key || lookup.has(key)) return;
    lookup.set(key, alias.font);
  });

  const missingKeys = requestedKeys.filter((key) => !lookup.has(key));
  if (missingKeys.length > 0) {
    const directMatches = await prisma.fontFamily.findMany({
      where: {
        normalizedFamily: {
          in: missingKeys,
        },
      },
      include: {
        files: true,
        aliases: true,
      },
    });
    directMatches.forEach((font) => {
      const key = String(font?.normalizedFamily || "").trim();
      if (!key || lookup.has(key)) return;
      lookup.set(key, font);
    });
  }

  return lookup;
}

export async function upsertFontFamilyWithFiles({
  id,
  family,
  displayName,
  source = FONT_SOURCE_CUSTOM,
  sourceId,
  status = FONT_STATUS_READY,
  categories,
  previewText,
  previewWeight,
  cssFontFamily,
  removable = true,
  files = [],
  aliases = [],
}) {
  const normalizedFamily = normalizeFontStorageKey(family);
  if (!normalizedFamily) {
    throw new Error("Font family is required.");
  }

  const safeFamily = String(family || "").trim();
  const safeDisplayName = String(displayName || "").trim() || deriveReadableFontLabel({ family: safeFamily });
  const normalizedSource = normalizeSource(source);
  const fileInputs = Array.from(
    new Map(
      (Array.isArray(files) ? files : [])
        .map(normalizeFontFileInput)
        .filter(Boolean)
        .map((file) => [file.kind, file])
    ).values()
  );

  const font = await prisma.fontFamily.upsert({
    where: { normalizedFamily },
    create: {
      ...(id ? { id } : {}),
      family: safeFamily,
      normalizedFamily,
      displayName: safeDisplayName,
      source: normalizedSource,
      sourceId: String(sourceId || "").trim() || null,
      status: normalizeStatus(status),
      categories: normalizeFontCategories(categories, safeFamily),
      previewText: String(previewText || "").trim() || null,
      previewWeight: Number.isFinite(Number(previewWeight)) ? Math.round(Number(previewWeight)) : null,
      cssFontFamily: String(cssFontFamily || "").trim() || `'${safeFamily}'`,
      removable: removable !== false,
    },
    update: {
      family: safeFamily,
      displayName: safeDisplayName,
      source: normalizedSource,
      sourceId: String(sourceId || "").trim() || null,
      status: normalizeStatus(status),
      categories: normalizeFontCategories(categories, safeFamily),
      previewText: String(previewText || "").trim() || null,
      previewWeight: Number.isFinite(Number(previewWeight)) ? Math.round(Number(previewWeight)) : null,
      cssFontFamily: String(cssFontFamily || "").trim() || `'${safeFamily}'`,
      removable: removable !== false,
    },
  });

  await prisma.$transaction(async (tx) => {
    const fileKinds = fileInputs.map((file) => file.kind);
    if (fileKinds.length > 0) {
      await tx.fontFile.deleteMany({
        where: {
          fontId: font.id,
          kind: {
            notIn: fileKinds,
          },
        },
      });
    }
    for (const file of fileInputs) {
      await tx.fontFile.upsert({
        where: {
          fontId_kind: {
            fontId: font.id,
            kind: file.kind,
          },
        },
        create: {
          fontId: font.id,
          ...file,
        },
        update: file,
      });
    }

    await tx.fontAlias.deleteMany({ where: { fontId: font.id } });
    const aliasInputs = normalizeAliasInputs({
      family: safeFamily,
      displayName: safeDisplayName,
      aliases,
    });
    if (aliasInputs.length > 0) {
      await tx.fontAlias.createMany({
        data: aliasInputs.map((alias) => ({
          fontId: font.id,
          ...alias,
        })),
        skipDuplicates: true,
      });
    }
  });

  // Catalog changed — advance the version so mobile clients re-fetch.
  await bumpFontCatalogVersion();

  return getFontFamilyById(font.id);
}

export async function deleteFontFamily({ id, family, source = FONT_SOURCE_CUSTOM }) {
  const normalizedId = String(id || "").trim();
  const normalizedFamily = normalizeFontStorageKey(family);
  if (!normalizedId && !normalizedFamily) {
    throw new Error("Missing font id or family.");
  }

  const where = {
    source: normalizeSource(source),
    ...(normalizedId ? { id: normalizedId } : { normalizedFamily }),
  };
  const existing = await prisma.fontFamily.findFirst({
    where,
    include: { files: true },
  });
  if (!existing) {
    return {
      deleted: false,
      font: null,
    };
  }
  await prisma.fontFamily.delete({ where: { id: existing.id } });

  // Catalog changed — advance the version so mobile clients re-fetch.
  await bumpFontCatalogVersion();

  return {
    deleted: true,
    font: existing,
  };
}
