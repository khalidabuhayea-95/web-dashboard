# Nayroz subscriptions (Plus & Pro) — backend spec

Status: implemented (2026-08-26), dev-verified via `npm run smoke:subscriptions`.
This doc is the contract for the backend team to review; every path below exists in the repo.

## 1. Architecture

```
   iOS app ── StoreKit 2 ──► Apple ──► App Store Server Notifications V2 ─┐
   Android ── Play Billing ─► Google ─► RTDN (Cloud Pub/Sub push) ────────┤
      │                                                                   ▼
      │  POST /api/mobile/subscriptions/verify          POST /api/webhooks/appstore
      │  (bearer; posts the store's proof)              POST /api/webhooks/playstore
      ▼                                                                   │
   src/lib/billing/* ◄────────────────────────────────────────────────────┘
      appleVerifier / googleVerifier → NormalizedStoreState
      → applyStoreState()  (the ONLY writer of subscription state)
      → Subscription rows + denormalized MobileUser.subscriptionTier/-ExpiresAt
      → silent FCM data push {type:"subscription_updated"} on tier flips
```

- **Payments never touch our servers** — Apple/Google process them; we verify proofs and track entitlement.
- **The server is the entitlement authority.** The app displays what the store SDK says, but every
  gated server endpoint re-checks the DB, and the app treats `GET /subscriptions/status` as truth.
- **No polling, no cron.** State changes arrive via the two webhooks; a lazy expiry guard
  (`resolveUserTier`, 24h grace) covers lost webhooks.

## 2. Definitions

| Concept | Value |
|---|---|
| Entitlement | `free` / `plus` / `pro` (see § Tier rename) |
| App Store products | `nayroz_plus_monthly`, `nayroz_plus_yearly`, `nayroz_pro_monthly`, `nayroz_pro_yearly` (3-day free intro offer on BOTH yearly plans) |
| Play subscriptions | `nayroz_plus` and `nayroz_pro`, each with base plans `monthly` / `yearly`; trial offer tagged `free-trial` |
| Canonical productId | Apple product id, or Play `subscriptionId:basePlanId` |
| Identity binding | iOS `appAccountToken` = MobileUser.id (a UUID — exact fit); Android `obfuscatedExternalAccountId` = MobileUser.id |
| Entitled-until-expiry | cancelling keeps the paid tier until `currentPeriodEnd`; `willRenew` goes false |

## 3. Data model (`prisma/schema.prisma`, migration `20260826120000_add_subscriptions`)

- `MobileUser.subscriptionTier` (`"free"`/`"pro"`, default free) + `subscriptionExpiresAt` —
  denormalized read-fast copy for the request path. Written only by `applyStoreState()`.
- `Subscription` — one row per store subscription. `storeKey` (unique) is Apple
  `originalTransactionId` / Google **latest** `purchaseToken`: the idempotency key and the guard
  against one receipt unlocking two accounts. `linkedPurchaseToken` records Google supersession.
  Status: `active | trialing | cancelled | grace | hold | paused | expired | revoked`.
  `environment`: `production | sandbox | xcode-test`.
- `StoreNotification` — webhook dedupe/audit ledger, id = Apple `notificationUUID` / Pub/Sub
  `messageId`. Status `processing | processed | failed | skipped`; failed rows are retried on
  store redelivery and stay queryable for manual replay.

Entitlement rule (in `applyStoreState`/`getSubscriptionStatus`): a user is `pro` while ANY of
their rows has status in `{active, trialing, cancelled, grace}` and `currentPeriodEnd` in the
future (null end = open-ended grant). Non-production rows only count when
`ALLOW_SANDBOX_ENTITLEMENTS=1`.

## 4. Webhooks

### Apple — `POST /api/webhooks/appstore`
- Body `{ signedPayload }` (App Store Server Notifications **V2**). Authentication IS the JWS
  signature — verified against pinned Apple root CAs (`src/lib/billing/appleRootCerts.ts`)
  by `@apple/app-store-server-library`. Unverifiable → 401 (no retry value).
- Configure in ASC: App Information → App Store Server Notifications → V2, production + sandbox
  URLs both pointing here.

### Google — `POST /api/webhooks/playstore?token=<PLAY_RTDN_AUTH>`
- Cloud Pub/Sub push envelope; the `token` query param is compared timing-safe. RTDN carries no
  state — the processor refetches `purchases.subscriptionsv2.get` and applies that.
- Configure: Play Console → Monetization setup → RTDN → Pub/Sub topic; create a push
  subscription to this URL. Grant the Play service account `androidpublisher` access.

### Event handling (both funnel into `applyStoreState`)
| Store signal | Effect |
|---|---|
| purchase / renewal / resubscribe / plan change | row upserted, status active/trialing, tier `pro` |
| Apple `DID_CHANGE_RENEWAL_STATUS` off, Play `SUBSCRIPTION_CANCELED` | status `cancelled`, still entitled to period end |
| grace period | status `grace`, entitled to grace end |
| Play on-hold / paused / pending | `hold`/`paused` — not entitled |
| expiry | `expired`, tier recomputed → `free` |
| Apple `REFUND`/`REVOKE`, Play `SUBSCRIPTION_REVOKED` | `revoked` — entitlement off immediately |
| Google `linkedPurchaseToken` | superseded row force-expired; owner inherited when no account hint |
| TEST notifications | ledger row `skipped`, 200 |

Non-2xx ⇒ the store redelivers; the ledger retries failed rows and answers duplicates 200.

## 5. Credits integration

- `resolveMonthlyAllowance(settings, { userAllowance, tier })` — precedence:
  **per-user `creditAllowance` override > tier > free default**. The override beats the
  subscription in both directions so support can fix an account without touching billing.
- Settings blob `mobile_app_settings_v1.mediaCredits` gains `proMonthlyAllowance`
  (default **1000** — PLACEHOLDER economics: ≈$5/user/month provider cost; final number is a
  product decision, editable via the same admin settings API as `monthlyAllowance`).
- `GET /api/mobile/media/credits` now also returns `tier`, and its `allowance` reflects it.
- Tier is read through `resolveUserTier()` (lazy 24h-grace expiry guard) everywhere.

## 6. Mobile API additions (documented in `src/lib/mobile/openapi.js`; lint enforces coverage)

- `GET /api/mobile/subscriptions/status` (bearer) → `SubscriptionStatus`
  `{ tier, isSubscribed, expiresAt, store, productId, planKey, willRenew, periodType, environment }`.
- `POST /api/mobile/subscriptions/verify` (bearer, 12/5min rate limit)
  `{ platform: "apple"|"google", payload }` — Apple: transaction `jwsRepresentation`;
  Google: purchase token. Server re-verifies with the store, binds to the caller, answers with
  `SubscriptionStatus`. Errors: 422 `invalid_receipt`, 409 `receipt_conflict`.
- `POST /api/mobile/ai-tools/run` — premium tools now enforce: non-pro caller gets
  **403 `{ code: "subscription_required", subscription: { tier, required: "pro" } }`**
  (same structured-error style as `insufficient_credits`).
- Template payloads (list/search/by-subcategory/detail) now carry `isPremium`
  (from the new `Template.isPremium` column; default false). The app badges and walls at use.
  Server-side asset-download enforcement for premium templates is a noted follow-up, not in scope.

## 7. Ops

- Env (see `.env.example`): `APPLE_IAP_ISSUER_ID/KEY_ID/PRIVATE_KEY`, `APPLE_BUNDLE_ID`,
  `APPLE_APP_APPLE_ID` (prod), `APPLE_IAP_ENVIRONMENT` (`production|sandbox|xcode` — `xcode`
  accepts StoreKit-test receipts, simulator dev lane ONLY), `PLAY_PACKAGE_NAME`,
  `PLAY_SERVICE_ACCOUNT_JSON`, `PLAY_RTDN_AUTH`, `ALLOW_SANDBOX_ENTITLEMENTS`.
- Monitoring: `StoreNotification` rows with `status="failed"` need eyes — stores stop
  redelivering eventually (Apple retries a few times over days; Pub/Sub per its retry policy).
  An admin replay affordance is a follow-up; until then re-POSTing the stored decoded state via
  a small script is the manual path.
- Manual account fixes: set `MobileUser.creditAllowance` (credits only) or set
  `subscriptionTier`/`subscriptionExpiresAt` directly (full manual grant; honored by
  `resolveUserTier`, no Subscription row needed).

## 8. Test matrix

- `npm run smoke:subscriptions` — 13 checks: tier flip, pro allowance, receipt ownership,
  cancel-keeps-entitlement, expiry, sandbox policy, Google token supersession, ledger
  dedupe/retry. `npm run smoke:credits` still green (12 checks). Unit: `config.test.js`,
  `subscriptionTier.server.test.ts` (`node --import tsx --test …`).
- Store-integration testing (needs consoles): Apple sandbox tester renews yearly hourly and
  compresses the 3-day trial to ~2 minutes; cancel and watch `EXPIRED` arrive. Play license
  tester renews in minutes; verify RTDN → tier flip, restore-on-reinstall, monthly↔yearly change.

## 9. Open questions (product/owner decisions)

1. Prices for monthly/yearly (store consoles; not in code).
2. Final `proMonthlyAllowance` (1000 is a placeholder).
3. Refund policy surface (revoked = immediate cut-off today).
4. Premium-template asset-download enforcement server-side (currently client-walled only).
5. Admin UI: replay button for failed StoreNotification rows; proMonthlyAllowance field on
   /mobile-settings (both currently API-only).

## Tier rename: Plus / Pro (2026-08-31)

The two paid packages were **Nayroz Pro** and **Nayroz Pro Max**; they are now
**Nayroz Plus** (entry) and **Nayroz Pro** (top). Done before either store
console existed, because store product ids can never be renamed once created.

★The rename REUSES the string `pro`: it named the entry tier and now names the
top tier. Everything that persists a tier or a product id therefore had to be
remapped in one pass — migration `20260831180000_rename_tiers_plus_pro` does all
of it with single-`CASE` updates so no row is read after it has been rewritten:
`MobileUser.subscriptionTier`, `Subscription.productId`, and the mediaCredits
settings blob (allowance keys and reference-price keys both shift by one tier).

| | entry tier | top tier |
|---|---|---|
| name | Nayroz Plus | Nayroz Pro |
| tier value | `plus` | `pro` |
| App Store | `nayroz_plus_monthly` / `nayroz_plus_yearly` | `nayroz_pro_monthly` / `nayroz_pro_yearly` |
| Play | `nayroz_plus` + `monthly`/`yearly` base plans | `nayroz_pro` + same |
| allowance key | `plusMonthlyAllowance` (10,000) | `proMonthlyAllowance` (50,000) |
| price keys | `plus_monthly` / `plus_yearly` | `pro_monthly` / `pro_yearly` |
| paywall accent | antique gold `#8E641C` | imperial violet `#512E90` |

Two further consequences worth knowing:
- The status payload's `isPro` boolean is now **`isSubscribed`**. "isPro" became
  ambiguous the moment Pro was one specific tier rather than "paid at all".
- ★The premium AI-tool gate in `/api/mobile/ai-tools/run` read
  `tier !== "pro"` — which rejected top-tier (`pro_max`) subscribers from the
  very tools they paid most for. It now gates on `tier === FREE`, so any paid
  tier passes.

**Pro** (top): 5x the Plus AI allowance.
- Products: App Store `nayroz_pro_monthly` / `nayroz_pro_yearly`; Play
  subscription `nayroz_pro` with `monthly`/`yearly` base plans (same shapes
  as Plus). ★Yearly carries the same 3-day intro offer as Plus — the paywall
  advertises a trial on BOTH yearly plans (verified on the simulator), so both
  offers must be created in the consoles. Placeholder prices $24.99 / $249.99.
- Tier: `pro` (MobileUser.subscriptionTier, /subscriptions/status `tier`).
  `entitlementForProductId()` in `src/lib/billing/products.ts` maps product →
  tier; unknown products deliberately grant plain `plus`, never more.
- Allowance: `proMonthlyAllowance` (default 50,000) in the mediaCredits
  settings blob; `resolveMonthlyAllowance` precedence unchanged (personal
  override > tier > free).

**Credit inflation x10 + cost rebase** (migration
`20260831130000_inflate_credit_economy`): allowances, per-run costs, and the
whole MediaUsage ledger were multiplied by 10 (perception only — purchasing
power unchanged), and per-run costs were simultaneously rebased from measured
provider prices at the new anchor of 1 credit ≈ $0.0005:

| class | provider $/run | credits | charged | margin |
|---|---|---|---|---|
| nano-banana class (most tools/templates, edit, expand) | 0.039–0.040 | 100 | $0.050 | +25–28% |
| nano-banana-pro templates | 0.134 | 400 | $0.200 | +49% |
| colorize (deoldify) | 0.012 | 40 | $0.020 | +67% |
| enhance/unblur (esrgan), upscale, remove-background | ≤0.006 | 20 | $0.010 | ≥+67% |
| object-removal (lama) | 0.0005 | 10 | $0.005 | +900% |

The old table sold nano-banana-pro at a ~70% loss (8 credits ≈ $0.04 charged vs
$0.134 provider). Worst-case provider exposure is now allowance x $0.0004:
free $0.40/mo, Plus $4.00 (vs ~$4.24 net of the 15% store cut on $4.99),
Pro $20.00 (vs ~$21.24 net on $24.99) — every package is worst-case
profitable on monthly pricing; yearly relies on typical (<100%) utilization.

Store consoles must mirror this when set up: create the two Pro products
alongside the Plus ones (§ manual setup).

### Dashboard-priced fallback catalog (2026-09-01)
`GET /api/mobile/subscriptions/catalog` (public) serves packages, monthly allowances and the
dashboard's reference prices. The app loads plans store-first: whenever StoreKit/Play return
products, the store's own localized price is shown verbatim (it is what the buyer is charged);
when the store has nothing — the simulator (a `.storekit` config only applies to Xcode's run
action), dev builds, or a storefront outage — the paywall renders the catalog's USD prices
instead. iOS's old hardcoded DEBUG preview plans were REMOVED in favour of this, so a dashboard
price edit reaches every no-console environment with no app change. The credits feature line also
reads the catalog's allowances, so paywall copy can never drift from what the wallet grants; its
"Nx Plus" suffix is computed and drops unless the ratio is a clean whole multiple.
★The admin must keep dashboard prices mirroring the store consoles — when the store answers, its
price wins, and a mismatch would surface as the paywall changing numbers between environments.
Plus monthly moved $4.99 → $5.99 here and in NayrozPro.storekit (2026-09-01, user decision); the
yearly badge consequently reads 44%.

### Pricing (2026-08-31)
The paywall's saving badge is *computed from the store's own prices* — there is no hardcoded
percentage, so changing a price in the console changes the badge with no app release, and each
package advertises its own figure.

| package | monthly | yearly | real saving | badge |
|---|---|---|---|---|
| Nayroz Plus | $5.99 | $39.99 | 44.4% | 44% |
| Nayroz Pro | $24.99 | $249.99 | 16.6% | 16% |

Both yearly plans carry a **3-day** free trial. ★The badge TRUNCATES rather than rounds (16.6%
shows as 16, not 17), so it can only ever understate what the buyer saves. To advertise an exact
target the yearly price must sit at or below `monthly x 12 x (1 - target)`.

★Plus's yearly discount is roughly double Pro's (33% vs 16%). Deliberate per the pricing
decision, but it means someone switching to the Pro tab sees the smaller badge right after the
larger one — revisit if Pro yearly conversion lags. Pro yearly at `$199.99` would read 33%.
