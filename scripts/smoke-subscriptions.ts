// End-to-end check of the Nayroz Pro subscription pipeline against the
// configured database — everything except the store calls themselves: state
// application, entitlement recompute, tier-aware credit allowances, receipt
// ownership, Google token supersession, sandbox policy, and the webhook
// dedupe ledger. Creates throwaway MobileUsers and deletes them (cascade
// removes their Subscription rows), restores the settings blob it touches.
// Run with `npm run smoke:subscriptions` after changing anything in
// src/lib/billing or the credits tier logic.
import prisma from "@/lib/prisma";
import { getUserCreditSummary } from "@/lib/media/credits/index.server";
import {
  getMobileAppSettings,
  saveMobileAppSettings,
} from "@/lib/settings/mobileAppSettings.server";
import { processStoreNotification } from "@/lib/billing/notificationLedger.server";
import {
  ReceiptOwnedByAnotherUserError,
  applyStoreState,
  getSubscriptionStatus,
  type NormalizedStoreState,
} from "@/lib/billing/subscriptionState.server";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label}` +
      (ok ? "" : `\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

function appleState(overrides: Partial<NormalizedStoreState> = {}): NormalizedStoreState {
  return {
    platform: "apple",
    storeKey: `smoke-apple-${process.pid}`,
    productId: "nayroz_plus_yearly",
    planKey: "yearly",
    status: "active",
    periodType: "normal",
    currentPeriodEnd: new Date(Date.now() + 30 * DAY_MS),
    autoRenewing: true,
    environment: "production",
    notificationType: null,
    ...overrides,
  };
}

async function main() {
  const originalSettings = await getMobileAppSettings();
  const originalAllowSandbox = process.env.ALLOW_SANDBOX_ENTITLEMENTS;

  await saveMobileAppSettings({
    mediaCredits: { monthlyAllowance: 20, plusMonthlyAllowance: 200,
        proMonthlyAllowance: 900 },
  });

  const user = await prisma.mobileUser.create({ data: { name: "subs-smoke", role: "user" } });
  const rival = await prisma.mobileUser.create({ data: { name: "subs-smoke-rival", role: "user" } });
  console.log(`test users ${user.id} / ${rival.id}\n`);

  try {
    // 1. Fresh account: free tier, free allowance.
    let credits = await getUserCreditSummary(user.id);
    check("fresh account is free with the free allowance", [credits.tier, credits.allowance], ["free", 20]);
    // ★The free grant is ONE TIME: its "used" figure is lifetime, so a run in a
    // previous month still counts against it and the balance never returns.
    await prisma.mediaUsage.create({
      data: {
        mobileUserId: user.id,
        feature: "edit-image",
        credits: 8,
        costMicros: 0,
        periodKey: "2020-01",
      },
    });
    credits = await getUserCreditSummary(user.id);
    check(
      "free tier counts usage from earlier months (one-time grant)",
      [credits.used, credits.remaining, credits.renews, credits.resetAt],
      [8, 12, false, null]
    );
    let status = await getSubscriptionStatus(user.id);
    check("fresh account status", [status.tier, status.isSubscribed, status.store], ["free", false, null]);

    // 2. A production Apple purchase entitles the user and boosts the wallet.
    await applyStoreState(appleState(), { mobileUserId: user.id });
    status = await getSubscriptionStatus(user.id);
    check(
      "apple purchase → pro",
      [status.tier, status.isSubscribed, status.store, status.planKey, status.willRenew],
      ["plus", true, "apple", "yearly", true]
    );
    credits = await getUserCreditSummary(user.id);
    check("pro wallet uses the pro allowance", [credits.tier, credits.allowance], ["plus", 200]);
    // Paid tiers are per-month, so that 2020 row must NOT count against them.
    check(
      "pro tier ignores earlier months and renews",
      [credits.used, credits.renews, credits.resetAt !== null],
      [0, true, true]
    );

    // 2b. Upgrade to Pro: the product id decides the tier, and the wallet
    // switches to the top-tier allowance saved in settings.
    await applyStoreState(
      appleState({ storeKey: `smoke-apple-max-${process.pid}`, productId: "nayroz_pro_yearly" }),
      { mobileUserId: user.id }
    );
    status = await getSubscriptionStatus(user.id);
    credits = await getUserCreditSummary(user.id);
    check("pro product grants the pro tier", [status.tier, status.isSubscribed], ["pro", true]);
    check("pro wallet uses the top-tier allowance", credits.allowance, 900);
    await prisma.subscription.deleteMany({ where: { storeKey: `smoke-apple-max-${process.pid}` } });

    // 3. The same receipt cannot entitle a second account.
    let conflict = false;
    try {
      await applyStoreState(appleState(), { mobileUserId: rival.id });
    } catch (error) {
      conflict = error instanceof ReceiptOwnedByAnotherUserError;
    }
    check("receipt is locked to its first account", conflict, true);
    check("rival stayed free", (await getSubscriptionStatus(rival.id)).isSubscribed, false);

    // 4. Cancelling keeps the paid-through entitlement but stops renewal.
    await applyStoreState(
      appleState({ status: "cancelled", autoRenewing: false, notificationType: "DID_CHANGE_RENEWAL_STATUS" })
    );
    status = await getSubscriptionStatus(user.id);
    check("cancelled = entitled until expiry", [status.isSubscribed, status.willRenew], [true, false]);

    // 5. Expiry drops the tier and the wallet back to free.
    await applyStoreState(
      appleState({ status: "expired", autoRenewing: false, currentPeriodEnd: new Date(Date.now() - DAY_MS), notificationType: "EXPIRED" })
    );
    status = await getSubscriptionStatus(user.id);
    credits = await getUserCreditSummary(user.id);
    check("expired → free", [status.isSubscribed, credits.tier, credits.allowance], [false, "free", 20]);

    // 6. Sandbox purchases only entitle when ALLOW_SANDBOX_ENTITLEMENTS=1.
    process.env.ALLOW_SANDBOX_ENTITLEMENTS = "";
    const sandboxKey = `smoke-apple-sandbox-${process.pid}`;
    await applyStoreState(appleState({ storeKey: sandboxKey, environment: "sandbox", status: "active", currentPeriodEnd: new Date(Date.now() + 30 * DAY_MS) }), { mobileUserId: user.id });
    check("sandbox purchase ignored by default", (await getSubscriptionStatus(user.id)).isSubscribed, false);
    process.env.ALLOW_SANDBOX_ENTITLEMENTS = "1";
    await applyStoreState(appleState({ storeKey: sandboxKey, environment: "sandbox", status: "active", currentPeriodEnd: new Date(Date.now() + 30 * DAY_MS) }));
    check("sandbox purchase honored when allowed", (await getSubscriptionStatus(user.id)).isSubscribed, true);
    // Retire the sandbox row so the Google steps below start from free.
    await applyStoreState(appleState({ storeKey: sandboxKey, environment: "sandbox", status: "expired", autoRenewing: false, currentPeriodEnd: new Date(Date.now() - DAY_MS) }));

    // 7. Google resubscribe: the new token supersedes the linked old one.
    const tokenA = `smoke-goog-a-${process.pid}`;
    const tokenB = `smoke-goog-b-${process.pid}`;
    await applyStoreState(
      appleState({ platform: "google", storeKey: tokenA, productId: "nayroz_plus:monthly", planKey: "monthly" }),
      { mobileUserId: user.id }
    );
    await applyStoreState(
      appleState({ platform: "google", storeKey: tokenB, productId: "nayroz_plus:yearly", planKey: "yearly", linkedPurchaseToken: tokenA })
    );
    const rowA = await prisma.subscription.findUnique({ where: { storeKey: tokenA }, select: { status: true } });
    status = await getSubscriptionStatus(user.id);
    check(
      "linked token superseded, one entitlement stands",
      [rowA?.status, status.isSubscribed, status.planKey],
      ["expired", true, "yearly"]
    );

    // 8. Webhook ledger: dedupe, then retry-on-failure.
    const noteId = `smoke-note-${process.pid}`;
    let runs = 0;
    const first = await processStoreNotification({
      id: noteId, platform: "apple", type: "TEST", payload: {},
      process: async () => { runs += 1; return "processed"; },
    });
    const duplicate = await processStoreNotification({
      id: noteId, platform: "apple", type: "TEST", payload: {},
      process: async () => { runs += 1; return "processed"; },
    });
    check("ledger processed once, duplicate acknowledged", [first.outcome, duplicate.outcome, runs], ["processed", "duplicate", 1]);

    const failId = `smoke-fail-${process.pid}`;
    const failed = await processStoreNotification({
      id: failId, platform: "google", type: "TEST", payload: {},
      process: async () => { throw new Error("boom"); },
    });
    const retried = await processStoreNotification({
      id: failId, platform: "google", type: "TEST", payload: {},
      process: async () => "processed",
    });
    check("failed delivery retries on redelivery", [failed.httpStatus, retried.outcome], [500, "processed"]);
  } finally {
    await prisma.storeNotification.deleteMany({ where: { id: { startsWith: "smoke-" } } });
    await prisma.mobileUser.deleteMany({ where: { id: { in: [user.id, rival.id] } } });
    await saveMobileAppSettings({ mediaCredits: originalSettings.mediaCredits ?? {} });
    if (originalAllowSandbox === undefined) delete process.env.ALLOW_SANDBOX_ENTITLEMENTS;
    else process.env.ALLOW_SANDBOX_ENTITLEMENTS = originalAllowSandbox;
    await prisma.$disconnect();
  }

  console.log(failures === 0 ? "\nAll subscription smoke checks passed." : `\n${failures} check(s) FAILED.`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
