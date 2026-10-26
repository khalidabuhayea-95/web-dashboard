import { PrismaClient } from "@prisma/client";
import { parsePublicObjectKey } from "@/lib/storage/objectStorage.server";
const p = new PrismaClient();
const els = await p.$queryRawUnsafe(`select source, asset_url from editor_element_assets where asset_url ilike '%.png%'`);
const keyOf = (u) => parsePublicObjectKey(u) || "";
const keys = els.map((e) => ({ source: e.source, key: keyOf(e.asset_url) }));
console.log("no key parsed", keys.filter((k) => !k.key).length, "sample", els[0]?.asset_url?.slice(0, 120));
const tpl = await p.$queryRawUnsafe(`select data::text as t from "Template"`);
const tplText = tpl.map((r) => r.t).join("\n");
const revCount = await p.$queryRawUnsafe(`select count(*)::int n, sum(length(snapshot::text))::bigint bytes from "TemplateRevision"`);
console.log("templates", tpl.length, "MB", Math.round(tplText.length / 1048576), "revisions", revCount);
const bySource = {};
for (const k of keys) {
  const s = (bySource[k.source] ||= { total: 0, inTemplates: 0 });
  s.total++;
  if (k.key && tplText.includes(k.key)) s.inTemplates++;
}
console.log(bySource);
const prefixes = {};
for (const k of keys) { const pre = k.key.split("/").slice(0, 4).join("/").replace(/^users\/[^/]+/, "users/*"); prefixes[`${k.source} ${pre}`] = (prefixes[`${k.source} ${pre}`] || 0) + 1; }
console.log(prefixes);
await p.$disconnect();
