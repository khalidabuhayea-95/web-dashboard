// The video fetches found in a Canva worker's Resource Timing. DAHZMKoVRF8's uploaded background
// clip was downloaded by Canva's web worker before the capture attached and played from memory,
// so the page saw no request and the import fell back to the poster. The block is evaluated
// straight out of background.js between its marker comments.
//
//   node --test extensions/canva-importer/test/worker-video-resources.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, "..", "background.js"), "utf8");
const start = source.indexOf("// ── canva-worker-video-resources:start");
const end = source.indexOf("// ── canva-worker-video-resources:end");
assert.ok(start >= 0 && end > start, "canva-worker-video-resources markers missing");
const context = vm.createContext({});
vm.runInContext(`${source.slice(start, end)}\nthis.collect = collectWorkerVideoResources;`, context);
const collect = (entries, id) => JSON.parse(JSON.stringify(context.collect(entries, id)));

test("a worker's signed media fetch of an uploaded clip is a video candidate", () => {
  const found = collect(
    [
      { name: "https://media.canva.com/v2/files/uri:ifs%3A%2F%2FV%2FwFLMjUlUw6Hb7RH5y7ES.mp4?csig=abc", initiatorType: "fetch", transferSize: 4_000_000 },
      { name: "https://media.canva.com/v2/files/uri:ifs%3A%2F%2FV%2Fposter.jpg?csig=abc", initiatorType: "fetch" },
      { name: "https://static.canva.com/web/worker.js", initiatorType: "script" },
      { name: "https://example.com/clip.mp4", initiatorType: "fetch" },
    ],
    "VAHZMI8aaC8"
  );
  assert.equal(found.length, 1);
  assert.match(found[0].url, /\.mp4\?csig=abc$/);
  assert.equal(found[0].initiatorType, "worker:fetch");
  assert.equal(found[0].bytes, 4_000_000);
});

test("a fetch named by the clip id, an encoded extension, or a /video/ path counts too", () => {
  const found = collect(
    [
      { name: "https://media.canva.com/v2/stream/VAHZMI8aaC8/chunk?x=1" },
      { name: "https://media.canva.com/v2/files/uri:ifs%3A%2F%2FV%2Fclip%2Emp4" },
      { name: "https://video.canva.com/video/abc" },
    ],
    "VAHZMI8aaC8"
  );
  assert.equal(found.length, 3);
  assert.deepEqual(collect(null, ""), []);
});
