// Shared vocabulary for the Magic Tools catalog, used by the admin API for
// validation and by the dashboard for its form limits.

export const DEFAULT_MAGIC_TOOL_CREDIT_COST = 8;
export const MAX_MAGIC_TOOL_TITLE_LENGTH = 120;
export const MAX_MAGIC_TOOL_SUBTITLE_LENGTH = 160;
export const MAX_MAGIC_TOOL_PROMPT_LENGTH = 4000;

// Same shape as the AI-template slugifier so hand-added tools and seeded ones
// stay consistent: apostrophes drop out rather than becoming separators.
export function slugifyMagicToolTitle(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
