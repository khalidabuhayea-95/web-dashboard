import { translateText } from "@/lib/tools/arabicTranslate.server";
import { buildTemplateSearchKeywords, keywordTargets } from "@/lib/search/templateKeywords.server";
async function main() {
  const name = "Blue and Black Modern Car Rental Mobile Video - فيديو للهاتف";
  console.log("targets", keywordTargets(name));
  try { console.log("raw", await translateText(name, { from: "en", to: "ar", attempts: 1 })); } catch (e) { console.log("raw error", String(e)); }
  console.log("built", await buildTemplateSearchKeywords(name));
}
main();
