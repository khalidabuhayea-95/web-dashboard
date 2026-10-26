import { buildTemplateSearchKeywords } from "@/lib/search/templateKeywords.server";
async function main() {
  for (const name of ["Certificate of Appreciation شهادة تقدير كحلي وبيج - مقاس A4", "قصة انستقرام منيو مقهى بنمط انيق وبسيط - قصتك", "Black Minimal Food Menu Instagram Story - قصتك"]) console.log(name, "→", (await buildTemplateSearchKeywords(name)).keywords.join(", "));
}
main();
