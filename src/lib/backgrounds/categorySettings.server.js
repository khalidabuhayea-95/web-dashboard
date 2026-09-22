import prisma from "@/lib/prisma";
import {
  BACKGROUND_CATEGORY_SETTINGS,
  sanitizeBackgroundCategorySettings,
} from "@/lib/backgrounds/categorySettings";
import { deleteImportedBackgroundAssetsByCategories } from "@/lib/editor/importedBackgrounds.server";
import { createLogger } from "@/lib/logging/logger";
import { deleteStorageForUrls } from "@/lib/storage/assetReferences.server";

const logger = createLogger("backgrounds.categorySettings");

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

/**
 * Deletes the backgrounds filed under categories that this save removed, and the R2 objects
 * behind them. Never throws: the settings are already written by the time this runs, and a
 * storage hiccup must not report the save as failed. Stranded objects are recoverable via
 * scripts/cleanup-orphan-media.ts.
 */
async function cascadeRemovedCategories(removedValues) {
  if (removedValues.length === 0) return { deletedAssets: 0, deletedObjects: 0 };

  try {
    const { deleted, urls } = await deleteImportedBackgroundAssetsByCategories(removedValues);
    const storage = await deleteStorageForUrls(urls, { removedValues });
    return { deletedAssets: deleted, deletedObjects: storage.deleted };
  } catch (error) {
    logger.error("Failed to delete backgrounds for removed categories", error, { removedValues });
    return { deletedAssets: 0, deletedObjects: 0 };
  }
}

/**
 * Saves the category list and cascades deletions.
 *
 * The page saves the whole list at once, so a removal is only visible as a diff: a `value`
 * present before and absent now. That is a safe signal because `value` is assigned once and is
 * not user-editable — renaming a category changes its labels, never its value — so a rename can
 * never be mistaken for a removal.
 */
export async function saveBackgroundCategorySettings(settings) {
  const sanitized = sanitizeBackgroundCategorySettings(settings);
  const previous = await getBackgroundCategorySettings();
  const nextValues = new Set(sanitized.map((item) => String(item.value || "")));
  const removedValues = previous
    .map((item) => String(item.value || ""))
    .filter((value) => value && !nextValues.has(value));

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

  const cascade = await cascadeRemovedCategories(removedValues);
  if (removedValues.length > 0) {
    logger.info("Background categories removed", {
      removedValues,
      deletedAssets: cascade.deletedAssets,
      deletedObjects: cascade.deletedObjects,
    });
  }

  return { settings: sanitized, removedCategories: removedValues, ...cascade };
}
