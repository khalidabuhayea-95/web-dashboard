// Deletes every row in editor_background_assets (the editor's Backgrounds library).
// Dry run by default so the wiring can be proven before anything is destroyed.
//
//   node --env-file=.env --env-file=.env.local --import tsx tmp/delete-backgrounds.ts
//   node --env-file=.env --env-file=.env.local --import tsx tmp/delete-backgrounds.ts --apply
//
// Afterwards sweep the stranded R2 files with:
//   node --env-file=.env --env-file=.env.local --import tsx scripts/cleanup-orphan-media.ts \
//     --areas=all --keep=ai-templates,magic-tools,text-effects --apply
import prisma from "@/lib/prisma";

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  console.log(`Mode: ${apply ? "APPLY (rows will be deleted)" : "dry run"}`);

  const before: any = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS c FROM editor_background_assets`
  );
  console.log(`editor_background_assets rows: ${before[0].c}`);

  if (!apply) {
    console.log("\nDry run — nothing deleted. Re-run with --apply.");
    await prisma.$disconnect();
    return;
  }

  const deleted = await prisma.$executeRawUnsafe(`DELETE FROM editor_background_assets`);
  const after: any = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS c FROM editor_background_assets`
  );
  console.log(`deleted: ${deleted}`);
  console.log(`rows remaining: ${after[0].c}`);
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  process.exitCode = 1;
  await prisma.$disconnect();
});
