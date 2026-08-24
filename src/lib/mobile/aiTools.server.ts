// One catalogue for the app's AI Tools tab, merging two admin-side systems that
// stay separate in the dashboard but are the same gesture to a user: pick a
// tool, give a photo, get a picture back.
//
//   MagicTool   -> one-tap fixes, no category            (id "magic:<slug>")
//   AiTemplate  -> styled scenes, grouped by category    (id "template:<slug>")
//
// SECURITY, the whole point of this file: `prompt` is the product. Every query
// below uses an explicit `select` that omits it, so no future column addition
// can leak instructions into a client response. Do not switch these to
// `include` or a bare findMany.

import prisma from "@/lib/prisma";
import { runAiTemplateRender } from "@/lib/aiTemplates/replicate.server";
import { runMagicTool } from "@/lib/magicTools/run.server";

export const AI_TOOL_KIND = { MAGIC: "magic", TEMPLATE: "template" } as const;
export type AiToolKind = (typeof AI_TOOL_KIND)[keyof typeof AI_TOOL_KIND];

/** Public shape of one tool. No prompt, no model id — both are server secrets. */
export type PublicAiTool = {
  id: string;
  kind: AiToolKind;
  slug: string;
  titleEn: string;
  titleAr: string;
  subtitleAr: string;
  /** What photo to ask the user for: "photo" for magic tools, else the
   *  template's reference kind ("man", "product", "food", …). */
  inputKind: string;
  /** False only for templates that generate a whole design from nothing. */
  requiresImage: boolean;
  creditCost: number;
  isPremium: boolean;
  beforeUrl: string | null;
  /** Full-size card art. Load this when a tool is opened, not in the grid. */
  afterUrl: string;
  /**
   * Grid-sized copy of `afterUrl` (400px, ~15 KB). List views must use this:
   * the full-size art averages ~140 KB, which is a ~30 MB tab across the whole
   * catalogue. Falls back to `afterUrl` on rows that predate the thumbnails.
   */
  thumbUrl: string;
};

export type AiToolSection = {
  id: string;
  kind: AiToolKind;
  titleEn: string;
  titleAr: string;
  tools: PublicAiTool[];
};

const MAGIC_SELECT = {
  slug: true,
  titleEn: true,
  titleAr: true,
  subtitleAr: true,
  creditCost: true,
  isPremium: true,
  beforeUrl: true,
  afterUrl: true,
  thumbUrl: true,
} as const;

const TEMPLATE_SELECT = {
  slug: true,
  titleEn: true,
  titleAr: true,
  referenceKind: true,
  creditCost: true,
  isPremium: true,
  beforeUrl: true,
  afterUrl: true,
  thumbUrl: true,
} as const;

export function buildAiToolId(kind: AiToolKind, slug: string): string {
  return `${kind}:${slug}`;
}

/** Splits "magic:enhance-photo" into its parts; null when malformed. */
export function parseAiToolId(value: unknown): { kind: AiToolKind; slug: string } | null {
  const raw = String(value || "").trim();
  const separator = raw.indexOf(":");
  if (separator < 1) return null;
  const kind = raw.slice(0, separator);
  const slug = raw.slice(separator + 1).trim();
  if (!slug) return null;
  if (kind !== AI_TOOL_KIND.MAGIC && kind !== AI_TOOL_KIND.TEMPLATE) return null;
  return { kind, slug };
}

type MagicRow = { [K in keyof typeof MAGIC_SELECT]: any };
type TemplateRow = { [K in keyof typeof TEMPLATE_SELECT]: any };

function magicToPublic(row: MagicRow): PublicAiTool {
  return {
    id: buildAiToolId(AI_TOOL_KIND.MAGIC, row.slug),
    kind: AI_TOOL_KIND.MAGIC,
    slug: row.slug,
    titleEn: row.titleEn,
    titleAr: row.titleAr,
    subtitleAr: row.subtitleAr || "",
    inputKind: "photo",
    requiresImage: true,
    creditCost: row.creditCost,
    isPremium: row.isPremium,
    beforeUrl: row.beforeUrl || null,
    afterUrl: row.afterUrl,
    thumbUrl: row.thumbUrl || row.afterUrl,
  };
}

function templateToPublic(row: TemplateRow): PublicAiTool {
  return {
    id: buildAiToolId(AI_TOOL_KIND.TEMPLATE, row.slug),
    kind: AI_TOOL_KIND.TEMPLATE,
    slug: row.slug,
    titleEn: row.titleEn,
    titleAr: row.titleAr,
    subtitleAr: "",
    inputKind: row.referenceKind,
    requiresImage: row.referenceKind !== "none",
    creditCost: row.creditCost,
    isPremium: row.isPremium,
    beforeUrl: row.beforeUrl || null,
    afterUrl: row.afterUrl,
    thumbUrl: row.thumbUrl || row.afterUrl,
  };
}

/**
 * The tab, in display order: magic tools first (they answer "fix my photo"),
 * then the template categories.
 *
 * Tools with no rendered `afterUrl` are omitted — the app draws a picture card
 * per tool, so an artless row would render as a hole. Unpublished rows are
 * omitted too. Premium rows ARE included, flagged, so the app can show them
 * behind a lock rather than hiding what an upgrade buys.
 */
export async function buildAiToolsCatalog(): Promise<{ sections: AiToolSection[] }> {
  const [magicTools, categories] = await Promise.all([
    prisma.magicTool.findMany({
      where: { published: true, afterUrl: { not: null } },
      orderBy: { sortOrder: "asc" },
      select: MAGIC_SELECT,
    }),
    prisma.aiTemplateCategory.findMany({
      orderBy: { sortOrder: "asc" },
      select: {
        slug: true,
        titleEn: true,
        titleAr: true,
        templates: {
          where: { published: true, afterUrl: { not: null } },
          orderBy: { sortOrder: "asc" },
          select: TEMPLATE_SELECT,
        },
      },
    }),
  ]);

  const sections: AiToolSection[] = [];

  if (magicTools.length) {
    sections.push({
      id: "magic",
      kind: AI_TOOL_KIND.MAGIC,
      titleEn: "Magic Tools",
      titleAr: "أدوات سحرية",
      tools: magicTools.map(magicToPublic),
    });
  }

  for (const category of categories) {
    if (!category.templates.length) continue;
    sections.push({
      id: `template:${category.slug}`,
      kind: AI_TOOL_KIND.TEMPLATE,
      titleEn: category.titleEn,
      titleAr: category.titleAr,
      tools: category.templates.map(templateToPublic),
    });
  }

  return { sections };
}

/**
 * Loads what a run needs, including the prompt — callers must use it only to
 * reach the provider and must never place it in a response body.
 */
export type ResolvedAiTool = {
  kind: AiToolKind;
  slug: string;
  titleEn: string;
  creditCost: number;
  isPremium: boolean;
  requiresImage: boolean;
  model: string;
  prompt: string;
  modelOptions: unknown;
};

export async function resolveAiTool(toolId: unknown): Promise<ResolvedAiTool | null> {
  const parsed = parseAiToolId(toolId);
  if (!parsed) return null;

  if (parsed.kind === AI_TOOL_KIND.MAGIC) {
    const row = await prisma.magicTool.findUnique({ where: { slug: parsed.slug } });
    if (!row || !row.published) return null;
    return {
      kind: AI_TOOL_KIND.MAGIC,
      slug: row.slug,
      titleEn: row.titleEn,
      creditCost: row.creditCost,
      isPremium: row.isPremium,
      requiresImage: true,
      model: row.model,
      prompt: row.prompt || "",
      modelOptions: row.modelOptions,
    };
  }

  const row = await prisma.aiTemplate.findUnique({ where: { slug: parsed.slug } });
  if (!row || !row.published) return null;
  return {
    kind: AI_TOOL_KIND.TEMPLATE,
    slug: row.slug,
    titleEn: row.titleEn,
    creditCost: row.creditCost,
    isPremium: row.isPremium,
    requiresImage: row.referenceKind !== "none",
    model: row.model,
    prompt: row.prompt,
    modelOptions: null,
  };
}

/** Runs a resolved tool. Returns the produced image bytes. */
export async function runAiTool(
  tool: ResolvedAiTool,
  imageBuffer: Buffer | null,
  imageMime: string
): Promise<{ buffer: Buffer; mimeType: string; model: string; predictionId: string | null }> {
  if (tool.kind === AI_TOOL_KIND.MAGIC) {
    return runMagicTool({
      modelId: tool.model,
      prompt: tool.prompt,
      modelOptions: tool.modelOptions,
      imageBuffer,
      imageMime,
    });
  }

  const result = await runAiTemplateRender({
    modelId: tool.model,
    prompt: tool.prompt,
    imageBuffer,
    imageMime,
  });
  return {
    buffer: result.buffer,
    // The template renderer always hands back a decoded image; the provider
    // emits PNG for every model in that registry.
    mimeType: "image/png",
    model: result.model,
    predictionId: result.predictionId || null,
  };
}
