/**
 *   node --import tsx --test src/lib/media/progressiveMp4.server.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";

import { isFragmentedMp4 } from "@/lib/media/progressiveMp4.server";

const box = (type: string, payload = new Uint8Array(0)) => {
  const out = new Uint8Array(8 + payload.length);
  new DataView(out.buffer).setUint32(0, out.length);
  out.set([...type].map((c) => c.charCodeAt(0)), 4);
  out.set(payload, 8);
  return out;
};
const join = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  parts.forEach((p) => { out.set(p, at); at += p.length; });
  return out;
};

test("a DASH capture (moov then moof/mdat fragments) is fragmented", () => {
  const file = join(box("ftyp", new Uint8Array(24)), box("moov", new Uint8Array(100)), box("sidx", new Uint8Array(40)), box("moof", new Uint8Array(50)), box("mdat", new Uint8Array(500)));
  assert.equal(isFragmentedMp4(file), true);
});

test("a progressive file (ftyp moov mdat) is not", () => {
  const file = join(box("ftyp", new Uint8Array(24)), box("moov", new Uint8Array(100)), box("free"), box("mdat", new Uint8Array(500)));
  assert.equal(isFragmentedMp4(file), false);
});

test("not an mp4, or a truncated one, is left alone", () => {
  assert.equal(isFragmentedMp4(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0])), false);
  assert.equal(isFragmentedMp4(new Uint8Array(0)), false);
  const truncated = join(box("ftyp", new Uint8Array(24)), box("moov", new Uint8Array(100))).subarray(0, 60);
  assert.equal(isFragmentedMp4(truncated), false);
});
