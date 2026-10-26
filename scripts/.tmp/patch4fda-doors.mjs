import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import vm from "node:vm";
const ID = "4fda5f23-9c5e-4260-a569-d6d1b1383445";
const source = fs.readFileSync("extensions/canva-importer/canva-fiber-main.js", "utf8");
const a = source.indexOf("// ── canva-motion-path:start");
const b = source.indexOf("// ── canva-motion-path:end");
const ctx = vm.createContext({});
vm.runInContext(`${source.slice(a, b)}\nthis.decode = decodeMotionPath;`, ctx);
// DAHNZVrSYZM's door tracks, read off Canva's live model (2026-10-14); both windows 0–2541.667 ms.
const TRACKS = {
  LBcGb5FWJ8g2f77h: {"Hjd":[12,12,11,3,2,3,4,4,5,3,2,3,4,3,4,3,4,3,4,3,4,3,4,3,4,3,4,3,4,3,4,3,4,6,6,6,6,6,6,6,7,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,7,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,7,6,6,6,3,0,3,3,4,3,3,3,3,4,3,3,3,3,4,3,3,3,3,2,2,3,3,3,0,3,0,4,0],"Ijd":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,1,0,0,0,0,0,0,1,0,0,0,0,1,0,0,0,0,0,1,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"dts":[8,11,31,171,27,8,16,17,17,17,17,36,22,35,15,9,14,18,12,9,17,19,18,16,9,13,15,10,8,6,6,16,35,43,15,16,14,9,10,17,17,18,18,43,18,15,16,17,16,16,18,25,24,20,17,12,12,10,10,10,11,13,16,20,15,11,16,19,21,14,23,15,13,13,16,16,18,18,31,43,18,17,17,17,17,24,26,50,16,52,9,25,18,16,9,9,16,18,16,16,34,33,9,8,17,50,25,8,52,18,50,17,66,17,69,17],"easing":2,"durationUs":1178000},
  LBnsBRHYj8GHdsfg: {"Hjd":[-24,-23,-24,-24,-24,-48,-49,-49,-49,-48,-47,-46,-50,-50,-27,-27,-28,-27],"Ijd":[-2,-2,0,1,0,0,1,0,0,-1,-3,-4,0,0,-1,-2,-2,-1],"dts":[21,24,17,16,16,23,17,12,19,17,19,18,17,19,10,10,12,39],"easing":2,"durationUs":1962000},
};
const prisma = new PrismaClient();
const t = await prisma.template.findUnique({ where: { id: ID } });
fs.writeFileSync(`tmp/template-4fda5f23-backup-${Date.now()}.json`, JSON.stringify(t, null, 2));
const data = JSON.parse(JSON.stringify(t.data));
for (const [id, track] of Object.entries(TRACKS)) {
  const o = data.objects.find((x) => x.importNodeId === id);
  const path = JSON.parse(JSON.stringify(ctx.decode(track, 2541.667)));
  o.mediaMotionPath = path;
  const mid = path.reduce((best, p) => (Math.abs(p.t - 600) < Math.abs(best.t - 600) ? p : best), path[0]);
  console.log(id.slice(0, 8), "points", path.length, "first", JSON.stringify(path[0]), "at~600ms", JSON.stringify(mid), "last", JSON.stringify(path[path.length - 1]));
}
if (process.argv[2] === "--write") {
  await prisma.template.update({ where: { id: ID }, data: { data } });
  const after = await prisma.template.findUnique({ where: { id: ID }, select: { updatedAt: true } });
  console.log("written", after.updatedAt.toISOString());
}
await prisma.$disconnect();
