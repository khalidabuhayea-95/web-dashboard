import { translateText } from "@/lib/tools/arabicTranslate.server";
import { buildTemplateSearchKeywords, keywordTargets } from "@/lib/search/templateKeywords.server";
async function main() {
  for (const name of ["White and Black Illustrative Car Rental Instagram Reel - فيديو للهاتف", "Red Black and White Modern Car Rental Instagram Post - منشور Instagram"]) {
    const part = name.replace(/[؀-ۿ]+/gu, " ").replace(/\s+/g, " ").trim();
    console.log(keywordTargets(name), "|", part, "→", await translateText(part, { from: "en", to: "ar", attempts: 1 }));
    console.log("   built:", (await buildTemplateSearchKeywords(name)).keywords.join(", "));
  }
}
main();
