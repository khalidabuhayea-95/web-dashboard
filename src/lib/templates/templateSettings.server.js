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
  } catch (error) {
    // ★Never fall back to TEMPLATE_CATEGORY_SETTINGS here. That legacy list has different
    // category ids from the saved taxonomy; serving it during a short DB outage (production
    // audit H-24) let the app cache a taxonomy whose every category then 400'd. Nothing is cached
    // on failure either — the next request retries the database. Callers map an outage to 503.
    if (diagnostics) {
      diagnostics.cacheHit = false;
      diagnostics.source = "error";
      diagnostics.readMs = roundTiming(performance.now() - startedAt);
    }
    throw error;
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
