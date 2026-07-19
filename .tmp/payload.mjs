import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const mod = await import("../src/lib/templates/mobileProject.js");
console.log("exports:", Object.keys(mod));
const rows = await prisma.$queryRaw`SELECT id, name, slug, data FROM "Template" WHERE id = '494cd442-09f1-4a76-adca-632108dfad91'::uuid`;
const t = rows[0];
const fn = mod.toMobileProject || mod.toMobileProjectSlim || mod.default;
const out = await fn({ ...t, data: t.data }, { fontLookup: new Map() });
const layers = out?.layers || out?.pages?.[0]?.layers || [];
for (const l of layers) {
  if (l.type !== "TEXT") continue;
  console.log("\n--- " + JSON.stringify(String(l.text).replace(/\n/g,"\\n").slice(0,45)));
  console.log("    keys: " + Object.keys(l).join(","));
  console.log("    " + JSON.stringify({ size: l.size, wrapWidth: l.wrapWidth, lineHeight: l.lineHeight, alignment: l.alignment, transform: l.transform }));
}
await prisma.$disconnect();
