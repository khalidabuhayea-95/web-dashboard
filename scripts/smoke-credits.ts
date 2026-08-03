// End-to-end check of the AI credit wallet against the configured database.
// Creates a throwaway MobileUser, exercises the guard and the spend roll-up, then
// deletes it. Run with `npm run smoke:credits` after changing credit costs, the
// monthly allowance, or the model price table.
//
// It writes the mediaCredits settings blob (allowance 20, edit=8, upscale=1) so the
// assertions are deterministic, then restores whatever was there before.
import prisma from "@/lib/prisma";
import {
  checkMediaCredits,
  enforceMediaCredits,
  getMediaUsageSummary,
  getUserCreditSummary,
  recordMediaUsage,
} from "@/lib/media/credits/index.server";
import {
  getMobileAppSettings,
  saveMobileAppSettings,
} from "@/lib/settings/mobileAppSettings.server";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label}` +
      (ok ? "" : `\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  );
}

async function main() {
  const originalSettings = await getMobileAppSettings();

  await saveMobileAppSettings({
    mediaCredits: {
      monthlyAllowance: 20,
      costs: { "edit-image": 8, "ai-expand": 8, upscale: 1, "object-removal": 1 },
    },
  });

  const user = await prisma.mobileUser.create({ data: { name: "credits-smoke", role: "user" } });
  console.log(`test user ${user.id}\n`);

  try {
    // 1. Fresh wallet.
    let balance = await checkMediaCredits({ mobileUserId: user.id, feature: "edit-image" });
    check(
      "fresh wallet",
      [balance.allowed, balance.allowance, balance.used, balance.remaining, balance.cost],
      [true, 20, 0, 20, 8]
    );

    check(
      "guard passes with credits",
      await enforceMediaCredits({ mobileUserId: user.id, feature: "edit-image" }),
      null
    );

    // 2. Two edits = 16 of 20 credits.
    for (let i = 0; i < 2; i += 1) {
      await recordMediaUsage({
        mobileUserId: user.id,
        feature: "edit-image",
        provider: "replicate",
        model: "google/nano-banana",
      });
    }
    balance = await checkMediaCredits({ mobileUserId: user.id, feature: "edit-image" });
    check("after 2 edits", [balance.used, balance.remaining], [16, 4]);

    // 3. A third edit costs 8 but only 4 remain — blocked, never charged negative.
    const denied = await enforceMediaCredits({ mobileUserId: user.id, feature: "edit-image" });
    const body = denied ? await denied.clone().json() : null;
    check("third edit blocked", denied?.status, 429);
    check("code=insufficient_credits", body?.code, "insufficient_credits");
    check("credits body", [body?.credits?.cost, body?.credits?.remaining], [8, 4]);
    check("X-Credits-Remaining header", denied?.headers.get("X-Credits-Remaining"), "4");

    // 4. The wallet is shared, not per-feature: a cheaper action still fits.
    const cheap = await checkMediaCredits({ mobileUserId: user.id, feature: "upscale" });
    check("cheap action still affordable", [cheap.allowed, cheap.cost, cheap.remaining], [true, 1, 4]);
    check(
      "cheap guard passes",
      await enforceMediaCredits({ mobileUserId: user.id, feature: "upscale" }),
      null
    );

    // 5. Spend the rest on upscales, then even the cheap action is refused.
    for (let i = 0; i < 4; i += 1) {
      await recordMediaUsage({
        mobileUserId: user.id,
        feature: "upscale",
        provider: "replicate",
        model: "nightmareai/real-esrgan",
      });
    }
    const empty = await checkMediaCredits({ mobileUserId: user.id, feature: "upscale" });
    check("wallet emptied", [empty.allowed, empty.used, empty.remaining], [false, 20, 0]);

    // 6. A per-user override tops the account back up without touching others.
    await prisma.mobileUser.update({
      where: { id: user.id },
      data: { creditAllowance: 100 },
    });
    const topped = await checkMediaCredits({ mobileUserId: user.id, feature: "edit-image" });
    check("per-user override applies", [topped.allowed, topped.allowance, topped.remaining], [true, 100, 80]);

    // 7. An override of 0 blocks the account entirely.
    await prisma.mobileUser.update({ where: { id: user.id }, data: { creditAllowance: 0 } });
    const zeroed = await checkMediaCredits({ mobileUserId: user.id, feature: "edit-image" });
    check("override 0 blocks account", [zeroed.allowed, zeroed.allowance, zeroed.remaining], [false, 0, 0]);
    await prisma.mobileUser.update({ where: { id: user.id }, data: { creditAllowance: null } });

    // 8. A removed feature must never be recorded or gated.
    check(
      "removed feature fails open",
      await enforceMediaCredits({ mobileUserId: user.id, feature: "image-to-layers" }),
      null
    );
    await recordMediaUsage({ mobileUserId: user.id, feature: "image-to-layers", model: "x" });

    // 9. Spend report: 2 edits x $0.039 + 4 upscales x $0.002 = $0.086.
    const summary = await getMediaUsageSummary({ mobileUserId: user.id });
    check("recorded runs", summary.totalRuns, 6);
    check("credits spent", summary.totalCredits, 20);
    check("provider spend", Number(summary.totalCostUsd.toFixed(6)), 0.086);

    // 10. The wallet endpoint's payload.
    const wallet = await getUserCreditSummary(user.id);
    check("wallet summary", [wallet.allowance, wallet.used, wallet.remaining], [20, 20, 0]);
    check("wallet exposes costs", wallet.costs["edit-image"], 8);
  } finally {
    await prisma.mediaUsage.deleteMany({ where: { mobileUserId: user.id } });
    await prisma.mobileUser.delete({ where: { id: user.id } });
    await saveMobileAppSettings({ mediaCredits: originalSettings.mediaCredits });
    await prisma.$disconnect();
    console.log("\ncleaned up test user and restored settings");
  }

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
