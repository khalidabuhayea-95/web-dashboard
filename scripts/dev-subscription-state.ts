// Dev-only lever for walking a REAL account through the Pro lifecycle without a
// store, so the app can be watched reacting to each transition. Everything after
// the receipt is the production path: applyStoreState is the only writer of
// entitlement, exactly as a verified purchase or a store webhook would call it.
//
//   npm run dev:subscription -- <email> purchase|trial|cancel|expire|refund|status
//
// The store call itself is the one thing this cannot stand in for — a real
// purchase needs an Xcode run with NayrozPro.storekit (iOS) or a Play Console
// listing plus a license tester (Android).
import prisma from "@/lib/prisma";
import { getUserCreditSummary } from "@/lib/media/credits/index.server";
import {
  applyStoreState,
  getSubscriptionStatus,
  type NormalizedStoreState,
} from "@/lib/billing/subscriptionState.server";

const DAY_MS = 24 * 60 * 60 * 1000;
const ACTIONS = ["purchase", "purchase-max", "trial", "cancel", "expire", "refund", "status"] as const;
type Action = (typeof ACTIONS)[number];

/** One stable store key per account, so repeat runs update the same row. */
function storeKeyFor(mobileUserId: string): string {
  return `dev-apple-${mobileUserId}`;
}

function stateFor(action: Exclude<Action, "status">, mobileUserId: string): NormalizedStoreState {
  const base: NormalizedStoreState = {
    platform: "apple",
    storeKey: storeKeyFor(mobileUserId),
    productId: action === "purchase-max" ? "nayroz_pro_yearly" : "nayroz_plus_yearly",
    planKey: "yearly",
    status: "active",
    periodType: "normal",
    currentPeriodEnd: new Date(Date.now() + 365 * DAY_MS),
    autoRenewing: true,
    environment: "production",
    notificationType: null,
  };
  switch (action) {
    case "purchase":
    case "purchase-max":
      return base;
    case "trial":
      return { ...base, periodType: "trial", currentPeriodEnd: new Date(Date.now() + 7 * DAY_MS) };
    // Cancelled but paid up: still entitled until the period ends. This is the
    // state most likely to be got wrong, so it is worth watching in the app.
    case "cancel":
      return { ...base, status: "cancelled", autoRenewing: false };
    case "expire":
      return {
        ...base,
        status: "expired",
        autoRenewing: false,
        currentPeriodEnd: new Date(Date.now() - DAY_MS),
      };
    case "refund":
      return {
        ...base,
        status: "revoked",
        autoRenewing: false,
        currentPeriodEnd: new Date(Date.now() - DAY_MS),
      };
  }
}

async function main() {
  const [email, rawAction = "status"] = process.argv.slice(2);
  if (!email) throw new Error(`Usage: npm run dev:subscription -- <email> ${ACTIONS.join("|")}`);
  const action = rawAction as Action;
  if (!ACTIONS.includes(action)) throw new Error(`Unknown action "${rawAction}"`);

  const user = await prisma.mobileUser.findFirst({
    where: { email },
    select: { id: true, email: true },
  });
  if (!user) throw new Error(`No mobile user with email ${email}`);

  if (action !== "status") {
    await applyStoreState(stateFor(action, user.id), { mobileUserId: user.id });
  }

  const status = await getSubscriptionStatus(user.id);
  const credits = await getUserCreditSummary(user.id);
  console.log(`${user.email}  →  ${action}`);
  console.log(
    JSON.stringify(
      {
        tier: status.tier,
        isSubscribed: status.isSubscribed,
        willRenew: status.willRenew,
        periodType: status.periodType,
        expiresAt: status.expiresAt,
        creditsAllowance: credits.allowance,
        creditsRemaining: credits.remaining,
      },
      null,
      2
    )
  );
  console.log("\nPull to refresh in the app, or relaunch, to see it apply.");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
