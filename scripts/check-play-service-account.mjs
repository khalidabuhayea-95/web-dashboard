#!/usr/bin/env node
/**
 * Proves a Google Play service account is wired up correctly, before you find out
 * the hard way that a test purchase cannot be verified.
 *
 * Run it right after pasting PLAY_SERVICE_ACCOUNT_JSON into .env:
 *
 *     node scripts/check-play-service-account.mjs
 *
 * It checks four things in order, and stops at the first that fails, because each
 * one is a precondition for the next:
 *
 *   1. the key parses and looks like a service-account key,
 *   2. Google will mint an androidpublisher token for it (the key is valid and
 *      the Android Publisher API is enabled on its Cloud project),
 *   3. Play Console has actually granted this account access to THIS package —
 *      this is the step everyone forgets, and it fails with a 401 that says
 *      nothing useful until you read it here,
 *   4. the two subscriptions the app queries exist, with the base plans and the
 *      free-trial offer tag the server expects.
 *
 * Read-only: it never writes to Play.
 */

import { readFileSync } from "node:fs";
import { JWT } from "google-auth-library";
import dotenv from "dotenv";

dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.local", override: true });

const BASE = "https://androidpublisher.googleapis.com/androidpublisher/v3";

// Must stay in step with src/lib/billing/products.ts and the Android gateway.
const EXPECTED = {
  subscriptions: ["nayroz_plus", "nayroz_pro"],
  basePlans: ["monthly", "yearly"],
  trialOfferTag: "free-trial",
  trialOnBasePlan: "yearly",
};

const ok = (m) => console.log(`  [32m✓[0m ${m}`);
const bad = (m) => console.log(`  [31m✗[0m ${m}`);
const info = (m) => console.log(`    ${m}`);

function fail(message, remedy) {
  bad(message);
  if (remedy) {
    console.log("");
    console.log("  الحل:");
    for (const line of remedy) console.log(`    · ${line}`);
  }
  console.log("");
  process.exit(1);
}

function loadServiceAccount() {
  const raw = String(process.env.PLAY_SERVICE_ACCOUNT_JSON ?? "").trim();
  if (!raw) {
    fail("PLAY_SERVICE_ACCOUNT_JSON is not set", [
      "ضع محتوى ملف مفتاح حساب الخدمة في .env تحت PLAY_SERVICE_ACCOUNT_JSON",
      "يقبل الخادم الصيغة الخام أو base64 — الأسهل base64 لأنه سطر واحد:",
      "  PLAY_SERVICE_ACCOUNT_JSON=$(base64 -i ~/Downloads/key.json)",
    ]);
  }
  // Same parsing the server does (playServiceAccount in billingEnv.server.ts).
  const candidates = raw.startsWith("{")
    ? [raw]
    : [(() => { try { return Buffer.from(raw, "base64").toString("utf8"); } catch { return ""; } })(), raw];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (typeof parsed?.client_email === "string" && typeof parsed?.private_key === "string") {
        return parsed;
      }
    } catch {
      // try the next candidate
    }
  }
  fail("PLAY_SERVICE_ACCOUNT_JSON does not parse as a service-account key", [
    "تأكد أنك نسخت الملف كاملاً بما فيه الأقواس { }",
    "الملف الصحيح يحتوي الحقلين client_email و private_key",
  ]);
}

async function main() {
  const packageName = String(process.env.PLAY_PACKAGE_NAME ?? "").trim() || "com.nayroz.android";

  console.log("");
  console.log("Google Play service account check");
  console.log(`package: ${packageName}`);
  console.log("");

  // ── 1. the key itself ────────────────────────────────────────────────────────
  console.log("1. مفتاح حساب الخدمة");
  const account = loadServiceAccount();
  ok(`parsed — ${account.client_email}`);
  if (account.project_id) info(`Cloud project: ${account.project_id}`);
  console.log("");

  // ── 2. can it get a token? ───────────────────────────────────────────────────
  console.log("2. المصادقة مع Google");
  const jwt = new JWT({
    email: account.client_email,
    key: account.private_key,
    scopes: ["https://www.googleapis.com/auth/androidpublisher"],
  });
  let headers;
  try {
    headers = await jwt.getRequestHeaders();
    ok("androidpublisher access token issued");
  } catch (error) {
    fail(`could not get a token — ${error?.message ?? error}`, [
      "تأكد أن Android Publisher API مفعّلة في مشروع Google Cloud نفسه",
      "console.cloud.google.com → APIs & Services → Enable APIs → Google Play Android Developer API",
      "وتأكد أن المفتاح لم يُحذف من حساب الخدمة",
    ]);
  }
  console.log("");

  // ── 3. does Play Console grant it this package? ──────────────────────────────
  console.log("3. صلاحية الوصول إلى التطبيق في Play Console");
  // ★ It is /applications/<pkg>/subscriptions — NOT /monetization/subscriptions, which is a
  // plausible-looking path that does not exist and answers with an HTML 404 page rather than a
  // JSON API error, so it reads as a permission problem when it is a typo.
  const listUrl = `${BASE}/applications/${encodeURIComponent(packageName)}/subscriptions?pageSize=50`;
  const response = await fetch(listUrl, { headers });
  if (response.status === 401 || response.status === 403) {
    const body = await response.text();
    fail(`Play refused the request (${response.status})`, [
      "هذه أشهر خطوة تُنسى: الحساب موجود لكن Play Console لم تمنحه صلاحية على التطبيق",
      "Play Console → Users and permissions → Invite new users",
      `ادعُ ${account.client_email}`,
      "امنحه صلاحية التطبيق نيروز، وفعّل: View financial data و Manage orders and subscriptions",
      "الصلاحية قد تحتاج بضع دقائق حتى تسري",
      `الرد الخام: ${body.slice(0, 300)}`,
    ]);
  }
  if (!response.ok) {
    const body = await response.text();
    fail(`unexpected ${response.status} from Play`, [
      `تأكد أن اسم الحزمة صحيح: ${packageName}`,
      "وأن التطبيق مرفوع فعلاً إلى Play Console",
      `الرد الخام: ${body.slice(0, 300)}`,
    ]);
  }
  ok("Play Console grants this account access to the package");
  console.log("");

  // ── 4. do the products exist as the app expects? ─────────────────────────────
  console.log("4. الاشتراكات والخطط");
  // 204 = access is fine, there are simply no subscriptions yet.
  const payload = response.status === 204 ? {} : await response.json();
  const found = new Map(
    (payload.subscriptions ?? []).map((s) => [s.productId, s])
  );
  if (found.size === 0) {
    console.log("  [33m![0m لا توجد اشتراكات بعد — أنشئها ثم أعد التشغيل");
    info("Play Console → Monetize → Products → Subscriptions");
  }

  let allGood = found.size > 0;
  for (const subscriptionId of EXPECTED.subscriptions) {
    const sub = found.get(subscriptionId);
    if (!sub) {
      bad(`missing subscription: ${subscriptionId}`);
      allGood = false;
      continue;
    }
    ok(`subscription ${subscriptionId}`);

    const plans = new Map((sub.basePlans ?? []).map((p) => [p.basePlanId, p]));
    for (const basePlanId of EXPECTED.basePlans) {
      const plan = plans.get(basePlanId);
      if (!plan) {
        bad(`  missing base plan: ${subscriptionId} → ${basePlanId}`);
        allGood = false;
        continue;
      }
      const state = plan.state ?? "UNKNOWN";
      if (state === "ACTIVE") {
        info(`  base plan ${basePlanId}: ACTIVE`);
      } else {
        bad(`  base plan ${basePlanId} is ${state} — the app will not see it until it is ACTIVE`);
        allGood = false;
      }

      if (basePlanId === EXPECTED.trialOnBasePlan) {
        const offers = plan.offers ?? [];
        const tagged = offers.some((offer) =>
          (offer.offerTags ?? []).some((t) => t.tag === EXPECTED.trialOfferTag)
        );
        if (tagged) {
          info(`  free-trial offer tagged "${EXPECTED.trialOfferTag}" ✓`);
        } else {
          bad(
            `  yearly plan has no offer tagged "${EXPECTED.trialOfferTag}" — ` +
              "the paywall advertises a trial the server cannot label"
          );
          allGood = false;
        }
      }
    }
  }

  console.log("");
  if (allGood) {
    console.log("[32mجاهز.[0m حساب الخدمة يعمل والاشتراكات مضبوطة كما يتوقعها التطبيق.");
  } else {
    console.log("[33mحساب الخدمة يعمل، لكن إعداد الاشتراكات ناقص — راجع ما فوق.[0m");
  }
  console.log("");
  process.exit(allGood ? 0 : 1);
}

main().catch((error) => {
  console.error("");
  console.error("unexpected failure:", error?.message ?? error);
  console.error("");
  process.exit(1);
});
