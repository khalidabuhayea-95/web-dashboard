import fs from "node:fs";
import path from "node:path";
import prisma from "@/lib/prisma";
import { upsertEditorCustomFont } from "@/lib/editor/customFonts.server";
import { preserveTemplateUpdatedAt } from "@/lib/templates/featured.server";

const APPLY = process.argv.includes("--apply");
const FONT_DIR = "/private/tmp/claude-501/-Users-khalidabuhayea-AndroidStudioProjects-web-dashboard/d5655d27-8498-429d-8836-b6c45e4c23dd/scratchpad/fonts";
const WIDE_FAMILY_ID = "0f86d529-84e3-4733-9735-9091f20effaa";
const NARROW_ALIAS_ID = "b500d2f5-a429-403d-b7d5-c95df8013758"; // "Agrandir-Narrow Medium Italic" on the Wide family
const CUTS = [
  { weight: 400, file: "Agrandir-Narrow.e61d22b415193b15e4ad4b29.9987af8aac27cfc61dd33b5eff86aa5f.woff2", fileName: "Agrandir-Narrow.woff2" },
  { weight: 500, file: "Agrandir-NarrowMedium.5f30700a636a2ef520.36592d649293f6bc0d9194c5524e3b3d.woff2", fileName: "Agrandir-NarrowMedium.woff2" },
  { weight: 700, file: "Agrandir-NarrowBold.adf2cb74b97168e8d533.d5a8754ef38447b71e6d950981122e69.woff2", fileName: "Agrandir-NarrowBold.woff2" },
];
const TEMPLATE_PREFIXES = ["a1d1d005", "7cc63f90", "7f93e337", "5e205b06"];

const dataUrl = (file: string) => `data:font/woff2;base64,${fs.readFileSync(path.join(FONT_DIR, file)).toString("base64")}`;

function remap(objects: unknown, from: string, to: string): number {
  if (!Array.isArray(objects)) return 0;
  let changed = 0;
  for (const object of objects as Array<Record<string, unknown>>) {
    if (!object || typeof object !== "object") continue;
    if (Array.isArray(object.objects)) changed += remap(object.objects, from, to);
    const type = String(object.type || "").toLowerCase();
    if (!["text", "textbox", "i-text"].includes(type)) continue;
    for (const field of ["fontFamily", "fontName"]) {
      if (String(object[field] || "").trim().toLowerCase() === from.toLowerCase()) { object[field] = to; changed += 1; }
    }
    if (Array.isArray(object.textSpans)) {
      for (const span of object.textSpans as Array<Record<string, unknown>>) {
        if (span && String(span.fontFamily || "").trim().toLowerCase() === from.toLowerCase()) { span.fontFamily = to; changed += 1; }
      }
    }
  }
  return changed;
}

async function main() {
  console.log(APPLY ? "APPLY" : "DRY RUN");
  const existing = await prisma.fontFamily.findFirst({ where: { normalizedFamily: "agrandirnarrow" } });
  console.log("Agrandir Narrow family exists:", existing ? existing.id : "no");
  if (APPLY) {
    // The Canva name "Agrandir-Narrow Medium Italic" belongs to the Narrow family, not the Wide one.
    await prisma.fontAlias.deleteMany({ where: { id: NARROW_ALIAS_ID } });
    // A future import of Agrandir Wide (now named so by the file) merges into the family that holds it.
    await prisma.fontAlias.createMany({ data: [{ fontId: WIDE_FAMILY_ID, alias: "Agrandir Wide", normalizedAlias: "agrandirwide" }], skipDuplicates: true });
    const [primary, ...extras] = CUTS;
    const result = await upsertEditorCustomFont({
      family: "Agrandir Narrow",
      dataUrl: dataUrl(primary.file),
      mimeType: "font/woff2",
      fileName: primary.fileName,
      fontWeight: primary.weight,
      fontStyle: "normal",
      categories: ["latin"],
      extraVariants: extras.map((cut) => ({ dataUrl: dataUrl(cut.file), mimeType: "font/woff2", fileName: cut.fileName, weight: cut.weight, style: "normal" })),
      aliases: ["Agrandir-Narrow Medium Italic"],
      mergeCuts: true,
    } as never) as { font?: { id?: string; family?: string; files?: Array<{ kind: string }> } };
    console.log("font:", result?.font?.id, result?.font?.family, (result?.font?.files || []).map((f) => f.kind).join(","));
    const stored = await prisma.fontFamily.findFirst({ where: { normalizedFamily: "agrandirnarrow" }, include: { files: true, aliases: true } });
    console.log("stored:", stored?.id, stored?.family, stored?.files.map((f) => `${f.kind}:${f.fontWeight}`).join(","), "aliases", stored?.aliases.map((a) => a.alias).join("|"));
    if (!stored || stored.family !== "Agrandir Narrow") throw new Error("Narrow family not stored as expected; templates left untouched");
  }
  for (const prefix of TEMPLATE_PREFIXES) {
    const [row] = (await prisma.$queryRawUnsafe(`SELECT id, "updatedAt" FROM "Template" WHERE id::text LIKE $1`, `${prefix}%`)) as Array<{ id: string; updatedAt: Date }>;
    if (!row) { console.log(prefix, "missing"); continue; }
    const template = await prisma.template.findUnique({ where: { id: row.id }, select: { data: true } });
    const data = template!.data as Record<string, unknown>;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    fs.writeFileSync(path.join("tmp", `template-${prefix}-backup-${stamp}.json`), JSON.stringify(data));
    let changed = remap(data.objects, "Agrandir", "Agrandir Narrow");
    for (const page of (Array.isArray(data.pages) ? data.pages : []) as Array<Record<string, unknown>>) {
      changed += remap(page.elements, "Agrandir", "Agrandir Narrow");
      changed += remap(page.objects, "Agrandir", "Agrandir Narrow");
    }
    console.log(prefix, "texts re-pointed:", changed, "updatedAt", row.updatedAt.toISOString());
    if (APPLY && changed > 0) {
      await prisma.$transaction([
        preserveTemplateUpdatedAt(),
        prisma.$executeRaw`UPDATE "Template" SET data = ${JSON.stringify(data)}::jsonb WHERE id = ${row.id}::uuid`,
      ]);
      const after = (await prisma.template.findUnique({ where: { id: row.id }, select: { updatedAt: true } }))!;
      console.log("  saved; updatedAt now", after.updatedAt.toISOString());
    }
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
