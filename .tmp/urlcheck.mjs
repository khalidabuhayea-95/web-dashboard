import { rewritePublicObjectUrlsForClient as f } from "../src/lib/storage/objectStorage.server.js";
// A real public URL must still be rewritten to the proxy form (the function's actual job).
const input = { thumbnailDataUrl: "https://example.com/bucket/some/key.png", nested: { u: "https://example.com/bucket/a/b.jpg" } };
const out = f(input);
console.log("top-level :", out.thumbnailDataUrl);
console.log("nested    :", out.nested.u);
console.log("rewritten?:", out.thumbnailDataUrl !== input.thumbnailDataUrl);
