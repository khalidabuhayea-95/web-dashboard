import prisma from "@/lib/prisma";
import {
  BACKGROUND_CATEGORY_SETTINGS,
  sanitizeBackgroundCategorySettings,
} from "@/lib/backgrounds/categorySettings";

const BACKGROUND_CATEGORIES_KEY = "background_categories_v1";

export async function getBackgroundCategorySettings() {
  try {
    const record = await prisma.appSetting.findUnique({
      where: { key: BACKGROUND_CATEGORIES_KEY },
      select: { value: true },
    });

    if (!record) {
      return BACKGROUND_CATEGORY_SETTINGS;
    }

    return sanitizeBackgroundCategorySettings(record.value);
  } catch (_error) {
    return BACKGROUND_CATEGORY_SETTINGS;
  }
}

export async function saveBackgroundCategorySettings(settings) {
  const sanitized = sanitizeBackgroundCategorySettings(settings);

  try {
    await prisma.appSetting.upsert({
      where: { key: BACKGROUND_CATEGORIES_KEY },
      create: {
        key: BACKGROUND_CATEGORIES_KEY,
        value: sanitized,
      },
      update: {
        value: sanitized,
      },
    });
  } catch (error) {
    throw new Error(
      `Failed to save background category settings. Run database migration for AppSetting. ${
        error?.message || ""
      }`
    );
  }

  return sanitized;
}
