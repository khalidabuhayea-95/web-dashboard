import { PrismaClient } from "@prisma/client";
const c = new PrismaClient();
const q = (s) => c.$queryRawUnsafe(s);
console.log(await q(`SELECT show_trgm('كيكه') AS ar, show_trgm('cake') AS en, word_similarity('كيكه', 'كيكه عيد ميلاد') AS ws_exact, word_similarity('كيكا', 'كيكه عيد ميلاد') AS ws_typo, word_similarity('birtday', 'happy birthday cake') AS ws_en_typo, word_similarity('زفاف', 'دعوه زفاف ورديه') AS ws_ar2`));
console.log(await q(`SELECT datcollate, datctype FROM pg_database WHERE datname = current_database()`));
await c.$disconnect();
