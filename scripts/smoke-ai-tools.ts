// End-to-end check of the unified mobile AI Tools catalogue against the
// configured database. Read-only — it never writes or spends a credit.
//
// The headline assertion is the security one: the catalogue must not carry a
// prompt or a model id, because those ARE the product. Run this after touching
// src/lib/mobile/aiTools.server.ts or either catalogue's schema.
//
//   npm run smoke:ai-tools

import prisma from "@/lib/prisma";
import {
  buildAiToolsCatalog,
  parseAiToolId,
  resolveAiTool,
} from "@/lib/mobile/aiTools.server";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(`FAILED: ${message}`);
  console.log(`  ok  ${message}`);
}

async function main() {
  const catalog = await buildAiToolsCatalog();
  const tools = catalog.sections.flatMap((section) => section.tools);
  const serialized = JSON.stringify(catalog);

  console.log(
    `Catalogue: ${catalog.sections.length} section(s), ${tools.length} tool(s), ${serialized.length} bytes\n`
  );

  console.log("Security");
  // Substring search over the serialized payload, not a key check: this also
  // catches a prompt smuggled into a title or a description field.
  assert(!/"prompt"/i.test(serialized), "no `prompt` key anywhere in the payload");
  assert(
    !/(google\/nano-banana|replicate|real-esrgan|gfpgan|deoldify|flux-kontext|ideogram|qwen|seedream)/i.test(
      serialized
    ),
    "no provider or model identifiers leak"
  );
  const promptFragments = [
    "Keep the person",
    "Keep the product",
    "exactly identical",
    "photorealistic",
    "Do not add any new text",
  ];
  assert(
    promptFragments.every((fragment) => !serialized.toLowerCase().includes(fragment.toLowerCase())),
    "no prompt wording leaks"
  );
  assert(!/"modelOptions"/i.test(serialized), "no per-tool model settings leak");

  console.log("\nShape");
  assert(tools.length > 0, "the catalogue is not empty");
  assert(
    tools.every((tool) => typeof tool.afterUrl === "string" && tool.afterUrl.length > 0),
    "every tool has card artwork (no holes in the grid)"
  );
  assert(
    tools.every((tool) => Number.isInteger(tool.creditCost) && tool.creditCost >= 0),
    "every tool carries its own integer creditCost"
  );
  assert(
    new Set(tools.map((tool) => tool.id)).size === tools.length,
    "tool ids are unique across both catalogues"
  );
  assert(
    tools.every((tool) => parseAiToolId(tool.id) !== null),
    "every id round-trips through parseAiToolId"
  );
  assert(
    tools.every((tool) => !tool.requiresImage || tool.beforeUrl),
    "photo-taking tools show a sample input"
  );
  assert(
    tools.every((tool) => typeof tool.thumbUrl === "string" && tool.thumbUrl.length > 0),
    "every tool has a grid thumbnail"
  );
  // The whole point of thumbUrl is that the grid does not load the heavy art.
  // If they are the same URL everywhere, the backfill never ran.
  assert(
    tools.filter((tool) => tool.thumbUrl !== tool.afterUrl).length === tools.length,
    "no tool falls back to full-size art in the grid"
  );

  console.log("\nParser rejects junk");
  for (const bad of ["", "magic", "magic:", ":slug", "unknown:thing", "MAGIC:enhance-photo"]) {
    assert(parseAiToolId(bad) === null, `rejects ${JSON.stringify(bad)}`);
  }

  console.log("\nResolution (server side keeps the prompt)");
  const magic = tools.find((tool) => tool.kind === "magic");
  const template = tools.find((tool) => tool.kind === "template");
  assert(Boolean(magic), "catalogue includes magic tools");
  assert(Boolean(template), "catalogue includes template tools");

  const resolvedMagic = await resolveAiTool(magic!.id);
  assert(Boolean(resolvedMagic), `resolves ${magic!.id}`);
  assert(resolvedMagic!.creditCost === magic!.creditCost, "resolved price matches the listed price");
  assert(Boolean(resolvedMagic!.model), "resolved tool carries a model for the runner");

  const resolvedTemplate = await resolveAiTool(template!.id);
  assert(Boolean(resolvedTemplate), `resolves ${template!.id}`);
  assert(
    typeof resolvedTemplate!.prompt === "string" && resolvedTemplate!.prompt.length > 20,
    "resolved template still has its prompt server-side"
  );

  assert((await resolveAiTool("magic:does-not-exist")) === null, "unknown slug resolves to null");
  assert((await resolveAiTool("template:nope")) === null, "unknown template resolves to null");

  console.log("\nUnpublished rows stay hidden");
  const hidden = await prisma.magicTool.findFirst({ where: { published: false } });
  const hiddenTemplate = await prisma.aiTemplate.findFirst({ where: { published: false } });
  const hiddenIds = [
    hidden ? `magic:${hidden.slug}` : null,
    hiddenTemplate ? `template:${hiddenTemplate.slug}` : null,
  ].filter(Boolean) as string[];
  if (!hiddenIds.length) {
    console.log("  --  nothing unpublished right now; hiding it is covered by the query filter");
  } else {
    for (const id of hiddenIds) {
      assert(!tools.some((tool) => tool.id === id), `${id} is absent from the catalogue`);
      assert((await resolveAiTool(id)) === null, `${id} cannot be run`);
    }
  }

  console.log("\nSections");
  for (const section of catalog.sections) {
    console.log(
      `  ${String(section.tools.length).padStart(3)}  ${section.id.padEnd(28)} ${section.titleAr}`
    );
  }

  console.log("\nAll AI tools smoke checks passed.");
}

main()
  .catch((error) => {
    console.error(`\n${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
