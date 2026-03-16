import prisma from "@/lib/prisma";
import {
  sanitizeTemplateCategorySettings,
  TEMPLATE_CATEGORY_SETTINGS,
} from "@/lib/templates/templateSettings";

const TEMPLATE_TAXONOMY_KEY = "template_taxonomy";

export async function getTemplateTaxonomySettings() {
  try {
    const record = await prisma.appSetting.findUnique({
      where: { key: TEMPLATE_TAXONOMY_KEY },
      select: { value: true },
    });

    if (!record) {
      return TEMPLATE_CATEGORY_SETTINGS;
    }

    return sanitizeTemplateCategorySettings(record.value);
  } catch (_error) {
    return TEMPLATE_CATEGORY_SETTINGS;
  }
}

export async function saveTemplateTaxonomySettings(settings) {
  const sanitized = sanitizeTemplateCategorySettings(settings);

  try {
    await prisma.appSetting.upsert({
      where: { key: TEMPLATE_TAXONOMY_KEY },
      create: {
        key: TEMPLATE_TAXONOMY_KEY,
        value: sanitized,
      },
      update: {
        value: sanitized,
      },
    });
  } catch (error) {
    throw new Error(
      `Failed to save taxonomy settings. Run database migration for AppSetting. ${error?.message || ""}`
    );
  }

  return sanitized;
}
