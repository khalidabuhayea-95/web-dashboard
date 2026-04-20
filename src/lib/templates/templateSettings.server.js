import { performance } from "node:perf_hooks";

import prisma from "@/lib/prisma";
import {
  sanitizeTemplateCategorySettings,
  TEMPLATE_CATEGORY_SETTINGS,
} from "@/lib/templates/templateSettings";

const TEMPLATE_TAXONOMY_KEY = "template_taxonomy";
const TEMPLATE_TAXONOMY_CACHE_TTL_MS = 30_000;

let cachedTemplateTaxonomySettings = {
  value: null,
  expiresAt: 0,
};

function roundTiming(value) {
  return Math.round(value * 100) / 100;
}

export async function getTemplateTaxonomySettings(options = {}) {
  const diagnostics =
    options && typeof options === "object" && options.diagnostics && typeof options.diagnostics === "object"
      ? options.diagnostics
      : null;
  const startedAt = performance.now();
  const now = Date.now();
  if (cachedTemplateTaxonomySettings.value && cachedTemplateTaxonomySettings.expiresAt > now) {
    if (diagnostics) {
      diagnostics.cacheHit = true;
      diagnostics.source = "memory";
      diagnostics.readMs = roundTiming(performance.now() - startedAt);
    }
    return cachedTemplateTaxonomySettings.value;
  }

  try {
    const dbStartedAt = performance.now();
    const record = await prisma.appSetting.findUnique({
      where: { key: TEMPLATE_TAXONOMY_KEY },
      select: { value: true },
    });
    const dbMs = roundTiming(performance.now() - dbStartedAt);

    if (!record) {
      cachedTemplateTaxonomySettings = {
        value: TEMPLATE_CATEGORY_SETTINGS,
        expiresAt: now + TEMPLATE_TAXONOMY_CACHE_TTL_MS,
      };
      if (diagnostics) {
        diagnostics.cacheHit = false;
        diagnostics.source = "default";
        diagnostics.dbMs = dbMs;
        diagnostics.readMs = roundTiming(performance.now() - startedAt);
      }
      return TEMPLATE_CATEGORY_SETTINGS;
    }

    const sanitized = sanitizeTemplateCategorySettings(record.value);
    cachedTemplateTaxonomySettings = {
      value: sanitized,
      expiresAt: now + TEMPLATE_TAXONOMY_CACHE_TTL_MS,
    };
    if (diagnostics) {
      diagnostics.cacheHit = false;
      diagnostics.source = "database";
      diagnostics.dbMs = dbMs;
      diagnostics.readMs = roundTiming(performance.now() - startedAt);
    }
    return sanitized;
  } catch (_error) {
    cachedTemplateTaxonomySettings = {
      value: TEMPLATE_CATEGORY_SETTINGS,
      expiresAt: now + TEMPLATE_TAXONOMY_CACHE_TTL_MS,
    };
    if (diagnostics) {
      diagnostics.cacheHit = false;
      diagnostics.source = "fallback";
      diagnostics.readMs = roundTiming(performance.now() - startedAt);
    }
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

  cachedTemplateTaxonomySettings = {
    value: sanitized,
    expiresAt: Date.now() + TEMPLATE_TAXONOMY_CACHE_TTL_MS,
  };

  return sanitized;
}
