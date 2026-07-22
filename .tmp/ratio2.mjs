import { toMobileProjectSlim } from "../src/lib/templates/mobileProject.js";
const mk = (obj) => toMobileProjectSlim({ data: { width: 1080, height: 1080, objects: [obj] } }).layers[0]?.filters;
const a = mk({ type: "image", src: "https://x/y.png", left: 0, top: 0, width: 864, height: 317, scaleX: 1, scaleY: -1, cornerRadius: 27 });
const b = mk({ type: "image", src: "https://x/y.png", left: 0, top: 0, width: 1600, height: 586, scaleX: 0.54, scaleY: 0.541, cornerRadius: 27 });
console.log("editor-style ratio:", a.cornerRadius.toFixed(4), "(expect 0.0852)");
console.log("raw-fabric ratio:", b.cornerRadius.toFixed(4), "(expect ≈0.0852)");
