import { rewritePublicObjectUrlsForClient as f } from "../src/lib/storage/objectStorage.server.js";
const template = { id: "abc", name: "t", updatedAt: new Date("2026-07-15T08:24:00Z") };
console.log("Object.entries(new Date()) =", JSON.stringify(Object.entries(new Date())));
const out = f(template);
console.log("in  updatedAt:", template.updatedAt.toISOString());
console.log("out updatedAt:", JSON.stringify(out.updatedAt));
const overWire = JSON.parse(JSON.stringify(out));
console.log("client sees:", JSON.stringify(overWire.updatedAt), "-> String() =>", JSON.stringify(String(overWire.updatedAt)));

// regression: URL rewriting inside nested plain objects/arrays must still work
const nested = { a: { b: ["x"], when: new Date("2020-01-02T03:04:05Z") }, list: [{ when: new Date(0) }] };
const r = JSON.parse(JSON.stringify(f(nested)));
console.log("nested date  :", JSON.stringify(r.a.when));
console.log("in-array date:", JSON.stringify(r.list[0].when));
console.log("plain nested preserved:", JSON.stringify(r.a.b));
