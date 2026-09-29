// One-off: find font families that are copies of another family under a guessed or opaque name,
// and fold the ones you name into the family a fresh import now resolves to.
//
// Why they exist: Canva serves every font as WOFF2, and the import route couldn't read a WOFF2
// name table, so families were stored under the extension's guess ("Arimo Bold Italic" for a file
// that is Arimo Regular, "UKIJ Chi K" for UKIJ Chiwer Kesme) or under Canva's token — and a guess
// that differed from the family the library already had made a second copy. New imports read the
// real name (fontName.server.js) and merge into the existing family (fontMergePlan.js).
//
// REPORT (default) — for every custom family: the real name its own default file carries, the
// family an import of that font resolves to now, whether its files are byte-identical to that
// family's, whether its default face sits in the wrong weight slot, and how many templates and
// revisions still use its name.
//
// APPLY — `--apply --only="Name A,Name B"` folds exactly the families named (never the whole
// library: an app user's own saved project resolves fonts by family name through the catalog,
// which has no aliases, so folding a long-lived family can change their project's font):
//   1. files the target lacks move over (rows re-parented; their storage objects stay put);
//   2. every Template whose text uses the old name is rewritten to the target's family name —
//      the web editor declares @font-face under family names only, so an alias alone would draw
//      those texts in a fallback font. Raw SQL with the updatedAt trigger opted out: a font-name
//      rewrite changes no pixels, and a bump would discard the template's preview video;
//   3. the old family is deleted (deleteFontFamily cleans objects nothing references any more);
//   4. its names become aliases of the target, so revisions and the app's alias lookup resolve.
// A family is only folded when nothing can render differently: every file it shares a slot with
// the target is byte-identical, or no template or revision uses it at all.
//
//   node --env-file=.env --env-file=.env.local --import tsx scripts/merge-duplicate-font-families.ts
//   node --env-file=.env --env-file=.env.local --import tsx scripts/merge-duplicate-font-families.ts \
//     --apply --only="UKIJ Chi K,Arimo Bold Italic"

import { createHash } from "node:crypto";

import prisma from "@/lib/prisma";
import { getObject } from "@/lib/storage/objectStorage.server";
import { extractFontFaceInfo } from "@/lib/editor/fontName.server";
import {
  defaultWeightVariants,
  deleteFontFamily,
  findFontFamiliesByNames,
  mergeFontFamilyFiles,
  normalizeFontStorageKey,
} from "@/lib/editor/fontStorage.server";
import { preserveTemplateUpdatedAt } from "@/lib/templates/featured.server";

const APPLY = process.argv.includes("--apply");
// Also fold a family that only revisions (not live templates) still name. Restoring such a
// revision then draws the target's build of the same font.
const ALLOW_REVISIONS = process.argv.includes("--allow-revisions");
const ONLY = new Set(
  (process.argv.find((arg) => arg.startsWith("--only="))?.slice("--only=".length) || "")
    .split(",")
    .map((name) => normalizeFontStorageKey(name))
    .filter(Boolean)
);

type FontFileRow = {
  id: string;
  kind: string;
  checksum: string | null;
  storageBucket: string | null;
  storagePath: string | null;
  publicUrl: string | null;
};
type FamilyRow = {
  id: string;
  family: string;
  source: string;
  displayName: string | null;
  files: FontFileRow[];
  aliases: Array<{ alias: string }>;
};

async function readFileBytes(file: FontFileRow): Promise<Buffer | null> {
  try {
    if (file.storageBucket && file.storagePath) {
      const object = await getObject(file.storageBucket, file.storagePath);
      const body = object?.Body as { transformToByteArray?: () => Promise<Uint8Array> } | undefined;
      if (body?.transformToByteArray) return Buffer.from(await body.transformToByteArray());
    }
    if (file.publicUrl && /^https?:\/\//i.test(file.publicUrl)) {
      const response = await fetch(file.publicUrl);
      if (response.ok) return Buffer.from(await response.arrayBuffer());
    }
  } catch {
    // unreadable: reported as such
  }
  return null;
}

const checksumCache = new Map<string, string>();
async function fileChecksum(file: FontFileRow): Promise<string> {
  if (file.checksum) return file.checksum;
  const cached = checksumCache.get(file.id);
  if (cached) return cached;
  const bytes = await readFileBytes(file);
  const value = bytes ? createHash("sha256").update(bytes).digest("hex") : "";
  checksumCache.set(file.id, value);
  return value;
}

const TEXT_TYPES = new Set(["text", "textbox", "i-text"]);

/**
 * Every text font name a template payload uses (fabric objects, editor pages, group children),
 * with the weights its texts ask for.
 */
function collectTextFonts(node: unknown, out: Map<string, Set<number>>) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    node.forEach((child) => collectTextFonts(child, out));
    return;
  }
  const record = node as Record<string, unknown>;
  if (TEXT_TYPES.has(String(record.type || "").toLowerCase())) {
    const weight = Math.round(Number(record.fontWeight) || (String(record.fontWeight) === "bold" ? 700 : 400));
    for (const field of ["fontFamily", "fontName"]) {
      const key = normalizeFontStorageKey(record[field]);
      if (key) out.set(key, new Set([...(out.get(key) || []), weight]));
    }
  }
  for (const value of Object.values(record)) {
    if (value && typeof value === "object") collectTextFonts(value, out);
  }
}

/** Rewrites text font names equal (by storage key) to `fromKey`; returns how many it changed. */
function rewriteTextFonts(node: unknown, fromKey: string, toFamily: string): number {
  if (!node || typeof node !== "object") return 0;
  if (Array.isArray(node)) return node.reduce((sum, child) => sum + rewriteTextFonts(child, fromKey, toFamily), 0);
  const record = node as Record<string, unknown>;
  let changed = 0;
  if (TEXT_TYPES.has(String(record.type || "").toLowerCase())) {
    for (const field of ["fontFamily", "fontName"]) {
      if (normalizeFontStorageKey(record[field]) === fromKey) {
        record[field] = toFamily;
        changed += 1;
      }
    }
  }
  // The import's own record of the families it used (the editor registers them on load).
  if (Array.isArray(record.usedFonts)) {
    record.usedFonts = Array.from(
      new Set(
        (record.usedFonts as unknown[]).map((name) =>
          normalizeFontStorageKey(name) === fromKey ? toFamily : name
        )
      )
    );
  }
  for (const value of Object.values(record)) {
    if (value && typeof value === "object") changed += rewriteTextFonts(value, fromKey, toFamily);
  }
  return changed;
}

async function main() {
  const families = (await prisma.fontFamily.findMany({
    include: { files: true, aliases: { select: { alias: true } } },
    orderBy: { createdAt: "asc" },
  })) as unknown as FamilyRow[];
  const custom = families.filter((family) => family.source === "custom");

  const templates = await prisma.template.findMany({ select: { id: true, name: true, data: true } });
  const templateUsage = new Map<string, string[]>();
  const requestedWeights = new Map<string, Set<number>>();
  for (const template of templates) {
    const fonts = new Map<string, Set<number>>();
    collectTextFonts(template.data, fonts);
    for (const [key, weights] of fonts) {
      templateUsage.set(key, [...(templateUsage.get(key) || []), template.id]);
      requestedWeights.set(key, new Set([...(requestedWeights.get(key) || []), ...weights]));
    }
  }

  type Row = {
    family: FamilyRow;
    realName: string;
    weightClass: number;
    italic: boolean;
    target: FamilyRow | null;
    identical: boolean;
    conflictingKinds: string[];
    movableKinds: string[];
    templates: string[];
    revisions: number;
    requested: number[];
  };
  const rows: Row[] = [];

  for (const family of custom) {
    const defaultFile = family.files.find((file) => file.kind === "mobile") || family.files[0];
    const bytes = defaultFile ? await readFileBytes(defaultFile) : null;
    const info = extractFontFaceInfo(bytes);
    const realName = info?.family || "";
    let target: FamilyRow | null = null;
    if (realName) {
      const names = [realName, ...defaultWeightVariants(realName)];
      const lookup = await findFontFamiliesByNames(names);
      for (const name of names) {
        const found = lookup.get(normalizeFontStorageKey(name)) as FamilyRow | undefined;
        if (found) {
          target = found;
          break;
        }
      }
      if (target?.id === family.id) target = null;
    }

    const conflictingKinds: string[] = [];
    const movableKinds: string[] = [];
    if (target) {
      for (const file of family.files) {
        const counterpart = target.files.find((candidate) => candidate.kind === file.kind);
        if (!counterpart) {
          movableKinds.push(file.kind);
          continue;
        }
        const [mine, theirs] = await Promise.all([fileChecksum(file), fileChecksum(counterpart)]);
        if (!mine || mine !== theirs) conflictingKinds.push(file.kind);
      }
    }

    const key = normalizeFontStorageKey(family.family);
    const revisionRows = (await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS count FROM "TemplateRevision" WHERE POSITION($1 IN snapshot::text) > 0`,
      family.family
    )) as Array<{ count: number }>;
    rows.push({
      family,
      realName,
      weightClass: info?.weightClass || 0,
      italic: Boolean(info?.italic),
      target,
      identical: Boolean(target) && conflictingKinds.length === 0,
      conflictingKinds,
      movableKinds,
      templates: templateUsage.get(key) || [],
      revisions: Number(revisionRows?.[0]?.count || 0),
      requested: [...(requestedWeights.get(key) || [])].sort((a, b) => a - b),
    });
  }

  const duplicates = rows.filter((row) => row.target);
  const foldable = (row: Row) =>
    row.identical || (row.templates.length === 0 && (row.revisions === 0 || ALLOW_REVISIONS));
  console.log(`custom families: ${custom.length}; with a real name elsewhere in the library: ${duplicates.length}`);
  console.log(`  byte-identical (safe to fold): ${duplicates.filter((row) => row.identical).length}`);
  console.log(`  different build, unused (safe to fold): ${duplicates.filter((row) => !row.identical && foldable(row)).length}`);
  console.log(`  different build, in use (report only): ${duplicates.filter((row) => !foldable(row)).length}`);
  console.log("");
  for (const row of duplicates) {
    const verdict = row.identical ? "IDENTICAL" : foldable(row) ? "UNUSED" : "IN-USE";
    console.log(
      `${verdict.padEnd(9)} ${row.family.family.padEnd(26).slice(0, 26)} -> ${String(row.target?.family).padEnd(24).slice(0, 24)} ` +
        `(${row.target?.source}) real "${row.realName}" | templates ${row.templates.length} revisions ${row.revisions}` +
        (row.conflictingKinds.length ? ` | differs: ${row.conflictingKinds.join(",")}` : "") +
        (row.movableKinds.length ? ` | would move: ${row.movableKinds.join(",")}` : "")
    );
  }
  // A non-400 file in the default slot is right when the design only uses that weight (a Bold-only
  // title imports its Bold as the family's one face) — and wrong when some text asks the family for
  // a weight far from it: that text renders the other cut, or a synthesized bold on top of a bold.
  const mismatched = rows.filter(
    (row) =>
      row.weightClass > 0 &&
      row.requested.some((weight) => Math.abs(weight - row.weightClass) >= 200) &&
      !row.family.files.some((file) => file.kind !== "mobile")
  );
  if (mismatched.length) {
    console.log("");
    console.log(
      `single-face families whose texts ask for a weight 200+ away from the face's own (${mismatched.length}):`
    );
    for (const row of mismatched) {
      console.log(
        `  ${row.family.family.padEnd(26).slice(0, 26)} "${row.realName}" face ${row.weightClass}${row.italic ? " italic" : ""} | texts ask ${row.requested.join("/")} | templates ${row.templates.length}`
      );
    }
  }

  if (!APPLY) {
    console.log("\nReport only. Fold named families with --apply --only=\"Name A,Name B\".");
    return;
  }
  if (ONLY.size === 0) throw new Error("--apply needs --only=\"Name A,Name B\" — refusing to fold the whole library.");

  for (const row of duplicates) {
    if (!ONLY.has(normalizeFontStorageKey(row.family.family))) continue;
    const target = row.target as FamilyRow;
    if (!foldable(row)) {
      console.log(`SKIP ${row.family.family}: used by ${row.templates.length} templates / ${row.revisions} revisions and its files differ from ${target.family}`);
      continue;
    }
    const fromKey = normalizeFontStorageKey(row.family.family);

    // 1. Files the target lacks move over; their objects stay where they are.
    for (const kind of row.movableKinds) {
      const file = row.family.files.find((candidate) => candidate.kind === kind);
      if (file) await prisma.fontFile.update({ where: { id: file.id }, data: { fontId: target.id } });
    }

    // 2. Templates that use the old name now name the target (no updatedAt bump).
    let rewritten = 0;
    for (const templateId of row.templates) {
      const template = await prisma.template.findUnique({ where: { id: templateId }, select: { data: true } });
      if (!template) continue;
      const data = structuredClone(template.data);
      if (rewriteTextFonts(data, fromKey, target.family) === 0) continue;
      await prisma.$transaction([
        preserveTemplateUpdatedAt(),
        prisma.$executeRaw`UPDATE "Template" SET data = ${JSON.stringify(data)}::jsonb WHERE id = ${templateId}::uuid`,
      ]);
      rewritten += 1;
    }

    // 3. The copy goes, with whatever storage nothing references any more.
    const deleted = await deleteFontFamily({
      id: row.family.id,
      family: row.family.family,
      source: row.family.source,
    });

    // 4. Its names now resolve to the target (revisions, the app's alias lookup, future imports).
    await mergeFontFamilyFiles({
      fontId: target.id,
      aliases: [row.family.family, ...row.family.aliases.map((alias) => alias.alias)],
    });
    console.log(
      `FOLDED ${row.family.family} -> ${target.family}: moved ${row.movableKinds.length} file(s), ` +
        `rewrote ${rewritten} template(s), deleted ${deleted.deleted}`
    );
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
