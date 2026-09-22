# Google Play service account — setup for subscription testing

What this unlocks: the server can ask Google whether a purchase is real. Without it a test
purchase succeeds on the device and then `POST /api/mobile/subscriptions/verify` refuses to grant
the tier, which looks like a client bug and is not one.

Everything here happens once, in two consoles you own. After each stage, run the checker:

```bash
node scripts/check-play-service-account.mjs
```

It stops at the first broken stage and prints the fix, so work top to bottom until it says جاهز.

---

## 1 · Create the service account (Google Cloud Console)

The Play Console and Google Cloud are separate products; the account is created in Cloud and then
*invited* into Play. Both halves are required — doing only the first is the usual failure.

1. Open <https://console.cloud.google.com> with the Google account that owns the Play developer
   account. Pick the project linked to Play, or create one (any name).
2. **APIs & Services → Library** → search "Google Play Android Developer API" → **Enable**.
   Skipping this makes step 2 of the checker fail with `invalid_grant` / access denied.
3. **IAM & Admin → Service Accounts → Create service account**.
   - Name: `nayroz-play-billing` (anything works; this is the label you'll recognise later).
   - No Cloud IAM roles are needed. The permission that matters is granted in Play, not here.
4. Open the new account → **Keys → Add key → Create new key → JSON**. The file downloads once.
   There is no second copy: lose it and you create a new key.

## 2 · Grant it access to the app (Play Console)

This is the step that gets forgotten, and its failure mode is a bare 401 from Google.

1. <https://play.google.com/console> → **Users and permissions → Invite new users**.
2. Email: the `client_email` from the JSON key — it looks like
   `nayroz-play-billing@<project>.iam.gserviceaccount.com`.
3. **App permissions** → add the Nayroz app.
4. Grant, at minimum:
   - **View financial data, orders, and cancellation survey responses**
   - **Manage orders and subscriptions**
5. Invite. Access can take a few minutes to propagate — if the checker still 401s, wait and rerun.

## 3 · Put the key in the server env

The parser accepts raw JSON or base64. Base64 is one line, so it survives `.env` files and hosting
dashboards without escaping games:

```bash
echo "PLAY_SERVICE_ACCOUNT_JSON=$(base64 -i ~/Downloads/<key>.json)" >> .env
```

Also confirm `PLAY_PACKAGE_NAME=com.nayroz.android` (it defaults to that, so it only needs setting
if the applicationId ever changes).

Then:

```bash
node scripts/check-play-service-account.mjs
```

Stages 1–3 should pass. Stage 4 will report missing subscriptions until you do the next part.

---

## 4 · Create the subscriptions — the ids matter

★ **On Play these are TWO subscriptions with TWO base plans each — not four products.** The
four-id shape (`nayroz_plus_monthly`, …) is the **App Store** naming. Getting this wrong means the
app queries `nayroz_plus`, Play returns nothing, and the paywall shows no prices.

The client sends `nayroz_plus` / `nayroz_pro` and filters offers by `basePlanId`
(`androidApp/.../billing/AndroidBillingGateway.kt`), and the server rebuilds the canonical id as
`subscriptionId:basePlanId` (`src/lib/billing/products.ts`).

Play Console → **Monetize → Products → Subscriptions**:

| Subscription id | Base plan id | Notes |
|---|---|---|
| `nayroz_plus` | `monthly` | $5.99 |
| `nayroz_plus` | `yearly` | $39.99, plus a 3-day free-trial offer |
| `nayroz_pro` | `monthly` | $24.99 |
| `nayroz_pro` | `yearly` | $249.99, plus a 3-day free-trial offer |

Rules the code depends on:

- Base plan ids must be exactly `monthly` and `yearly` — `planKeyFromPlayBasePlan` matches those
  two strings and nothing else.
- Every base plan must be **activated**. A draft plan is invisible to the app.
- On each **yearly** plan add a free-trial offer and give it the offer tag **`free-trial`**.
  `PLAY_TRIAL_OFFER_TAG` is that literal string; without the tag the server cannot tell a trial
  from a paid period, and the paywall advertises a trial the backend will not label.
- Prices should match the dashboard catalogue that feeds `/api/mobile/subscriptions/catalog`, or
  the paywall and the store will quote different numbers.

Rerun the checker. Stage 4 verifies each subscription, each base plan's ACTIVE state, and the
trial tag.

---

## 5 · Real-time developer notifications (optional for a first test)

Verification works without this; RTDN is what keeps entitlements correct *after* purchase —
renewals, cancellations, refunds, grace periods.

1. Invent a shared secret and set `PLAY_RTDN_AUTH=<secret>` in the server env.
2. Google Cloud → **Pub/Sub → Create topic**, then a **push subscription** pointing at
   `https://<your-host>/api/webhooks/playstore?token=<PLAY_RTDN_AUTH>`.
3. Grant `google-play-developer-notifications@system.gserviceaccount.com` the
   **Pub/Sub Publisher** role on that topic.
4. Play Console → **Monetization setup** → paste the topic name.

The endpoint rejects any request whose `token` query parameter does not match, so the secret is the
only thing standing between the ledger and the open internet. Treat it like a password.

---

## 6 · Then test the purchase

- Upload a signed build to **Internal testing**. The app does not need to be public, but a build
  must exist in some track or purchases cannot be made.
- Play Console → **Setup → License testing** → add the tester's Google account. Test purchases are
  not charged, and renewal periods are compressed (a monthly plan renews in minutes), which is what
  makes renewal and cancellation testable in one sitting.
- Install from the internal-testing link on a device signed in as that account. A sideloaded build
  whose version code is not in a published track will fail at the purchase step.
- The server must be reachable from the phone. `localhost` will not do — deploy first, or the
  purchase will complete on the device and verification will time out.
- Keep `ALLOW_SANDBOX_ENTITLEMENTS=1` while testing so a test purchase actually flips the tier.
  **Set it to 0 in production**, or anyone with a sandbox purchase gets a real entitlement.

## Rotating or revoking

Delete the key in Cloud → Service Accounts → Keys, and remove the account from Play Console → Users
and permissions. Both halves, or a deleted key still leaves a principal with access.

---

## Status for Nayroz (done 2026-09-09)

Stages 1–3 are complete and verified by the checker:

| | |
|---|---|
| Cloud project | `nayroz` |
| Service account | `nayroz-play-billing@nayroz.iam.gserviceaccount.com` |
| Android Publisher API | Enabled |
| Play Console access | Active, 4 app permissions incl. View financial data + Manage orders and subscriptions |
| Key location | `PLAY_SERVICE_ACCOUNT_JSON` (base64) in `.env.local`, which is git-ignored |

Remaining: create the two subscriptions (§4). The checker reports them as missing, which is the
only thing standing between here and a test purchase — that and deploying the server somewhere the
phone can reach.

★ **Endpoint gotcha, already fixed in the checker**: the subscriptions list is
`/applications/<pkg>/subscriptions`. `/applications/<pkg>/monetization/subscriptions` looks right,
does not exist, and returns an HTML 404 page rather than a JSON API error — so it reads exactly
like a permission failure when it is a wrong path. An empty catalogue answers **204 No Content**,
not an empty list.
