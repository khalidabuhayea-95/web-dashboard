// CapCut's edit-api rejects get_package_info without its "sign" header: md5 of a fixed-salt string
// (copied from CapCut's draftPreload sidecode). The expected value below is a signature CapCut
// accepted on 2026-10-22. Evaluated straight out of capcut-import.js between its marker comments.
//
//   node --test extensions/canva-importer/test/capcut-sign.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, "..", "capcut-import.js"), "utf8");
const start = source.indexOf("// ── capcut-sign:start");
const end = source.indexOf("// ── capcut-sign:end");
assert.ok(start >= 0 && end > start, "capcut-sign markers missing");
const context = vm.createContext({ TextEncoder });
vm.runInContext(`${source.slice(start, end)}\nthis.md5 = capcutMd5; this.headers = capcutSignedHeaders;`, context);

test("md5 matches node's md5 on short, long and non-ASCII input", () => {
  for (const input of ["", "abc", "x".repeat(200), "9e2c|ge_info|7|5.8.0|1792652360||11ac", "قالب"]) {
    assert.equal(context.md5(input), createHash("md5").update(input, "utf8").digest("hex"));
  }
});

test("get_package_info headers reproduce a signature CapCut accepted", () => {
  const headers = context.headers("/lv/v1/draft/get_package_info", 1792652360, "5.8.0", "7");
  assert.equal(headers.sign, "e085592175948ff797beaf5803b67e40");
  assert.equal(headers["device-time"], "1792652360");
  assert.equal(headers["sign-ver"], "1");
  assert.equal(headers.pf, "7");
  assert.equal(headers.appvr, "5.8.0");
});
