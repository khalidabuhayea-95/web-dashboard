import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { resolveUserTier } from "@/lib/billing/subscriptionTier.server";
import { createLogger } from "@/lib/logging/logger";
import { resolveOptionalMobileBearer } from "@/lib/mobile/userAuth.server";
import prisma from "@/lib/prisma";
import { getMobileAppSettings } from "@/lib/settings/mobileAppSettings.server";
import {
  normalizeMediaCreditFeature,
  resolveCreditCost,
  resolveModelPriceMicros,
  resolveMonthlyAllowance,
  resolvePeriodKey,
  resolvePeriodResetAt,
} from "./config.js";

const logger = createLogger("media.credits");

export type MediaCreditBalance = {
  feature: string;
  /** Credits this run would cost. */
  cost: number;
  allowance: number;
  used: number;
  remaining: number;
  allowed: boolean;
  periodKey: string;
  /** Null when the tier's grant is one-time — nothing is going to reset. */
  resetAtIso: string | null;
  retryAfterSeconds: number;
};

type EnforceOptions = {
  mobileUserId: string;
  feature: string;
  message?: string;
  /** See checkMediaCredits — per-run price for catalogue-priced features. */
  costOverride?: number | null;
};

type RecordOptions = {
  mobileUserId: string;
  feature: string;
  model?: string | null;
  provider?: string | null;
  /** Overrides the configured credit cost (rarely needed). */
  credits?: number | null;
  /** Overrides the model price table (use for compound-priced runs). */
  costMicros?: number | null;
};

type FeatureGroupRow = {
  feature: string;
  _count: { _all: number };
  _sum: { costMicros: number | null; credits: number | null };
};

type ModelGroupRow = {
  model: string | null;
  _count: { _all: number };
  _sum: { costMicros: number | null };
};

type UsageGroupRow = {
  feature: string;
  model: string | null;
  _count: { _all: number };
  _sum: { costMicros: number | null; credits: number | null };
};

/**
 * Credits already spent, over the window the user's tier is billed on.
 *
 * ★The free allowance is ONE TIME, not monthly: a free account gets its credits
 * once and they do not come back, so its usage is summed over ALL time. Paid
 * tiers refill every month, so theirs is summed within the current period only.
 *
 * Consequence worth knowing: a lapsed subscriber's paid spending counts against
 * the free grant, so they do not land back on a fresh 1,000 credits each time a
 * subscription ends. That is the point of a one-time grant — it is per account,
 * not per visit to the free tier.
 */
async function sumCreditsUsed(
  mobileUserId: string,
  periodKey: string,
  { lifetime = false }: { lifetime?: boolean } = {},
): Promise<number> {
  const aggregate = await prisma.mediaUsage.aggregate({
    where: lifetime ? { mobileUserId } : { mobileUserId, periodKey },
    _sum: { credits: true },
  });
  return Number(aggregate._sum.credits || 0);
}

/** Free accounts are granted once; paid tiers refill monthly. */
export function isOneTimeAllowanceTier(tier: string): boolean {
  return tier !== "plus" && tier !== "pro";
}

// Number(null) === 0 passes Number.isFinite, so test for an explicit value.
function resolveRunCost(settings: unknown, feature: string, costOverride: number | null | undefined): number {
  const hasOverride =
    costOverride !== null && costOverride !== undefined && Number.isFinite(Number(costOverride));
  return hasOverride ? Math.max(0, Math.floor(Number(costOverride))) : resolveCreditCost(settings, feature);
}

function buildBalance({
  feature,
  cost,
  allowance,
  used,
  oneTime,
  now,
}: {
  feature: string;
  cost: number;
  allowance: number;
  used: number;
  oneTime: boolean;
  now: Date;
}): MediaCreditBalance {
  const resetAt = resolvePeriodResetAt(now);
  const retryAfterSeconds = Math.max(0, Math.ceil((resetAt.getTime() - now.getTime()) / 1000));
  const remaining = Math.max(0, allowance - used);
  return {
    feature,
    cost,
    allowance,
    used,
    remaining,
    // A zero-cost feature is always free to run; otherwise the run must fit in
    // what is left, so a user is never charged into a negative balance.
    allowed: cost === 0 || remaining >= cost,
    periodKey: resolvePeriodKey(now),
    // Null / no retry advice on a one-time grant: waiting for the month to
    // turn will not give a free account more credits.
    resetAtIso: oneTime ? null : resetAt.toISOString(),
    retryAfterSeconds: oneTime ? 0 : retryAfterSeconds,
  };
}

/**
 * The wallet for a feature, read from the database. THROWS when it cannot be read — use
 * checkMediaCredits for the fail-open variant.
 */
async function computeMediaCreditBalance({
  mobileUserId,
  feature,
  costOverride = null,
}: {
  mobileUserId: string;
  feature: string;
  costOverride?: number | null;
}): Promise<MediaCreditBalance> {
  const now = new Date();
  const normalizedFeature = normalizeMediaCreditFeature(feature);
  if (!normalizedFeature) throw new Error(`Unknown media credit feature: ${String(feature)}`);

  const [settings, user] = await Promise.all([
    getMobileAppSettings(),
    prisma.mobileUser.findUnique({
      where: { id: mobileUserId },
      select: { creditAllowance: true, subscriptionTier: true, subscriptionExpiresAt: true },
    }),
  ]);
  // The usage window depends on the tier, so it cannot join the parallel
  // fetch above — a free account is summed over all time, a paid one over
  // the current month.
  const tier = resolveUserTier(user);
  const oneTime = isOneTimeAllowanceTier(tier);
  const used = await sumCreditsUsed(mobileUserId, resolvePeriodKey(now), { lifetime: oneTime });

  return buildBalance({
    feature: normalizedFeature,
    cost: resolveRunCost(settings, normalizedFeature, costOverride),
    allowance: resolveMonthlyAllowance(settings, {
      userAllowance: user?.creditAllowance ?? null,
      tier,
    }),
    used,
    oneTime,
    now,
  });
}

/**
 * Reads a user's wallet for a given feature: what the run costs, what they have
 * left, and whether it fits.
 *
 * Fails OPEN: if the wallet cannot be read the request is allowed through and the
 * failure is logged as an error. A database blip should not take the AI features
 * offline, and the per-user rate limiter still caps the burst. To fail closed
 * instead, return `allowed: false` from the catch block below.
 *
 * ★Read-only, so it can never stop two concurrent runs from both passing: the paid routes
 * charge through reserveMediaCredits (atomic) instead. This stays for read paths and scripts.
 */
export async function checkMediaCredits({
  mobileUserId,
  feature,
  costOverride = null,
}: {
  mobileUserId: string;
  feature: string;
  /**
   * Price for THIS run, overriding the feature's configured cost. The AI Tools
   * tab needs it: every template and magic tool carries its own creditCost, so
   * one feature bucket covers runs priced anywhere from 2 to 8 credits.
   */
  costOverride?: number | null;
}): Promise<MediaCreditBalance> {
  const now = new Date();
  const normalizedFeature = normalizeMediaCreditFeature(feature);
  const openState = (): MediaCreditBalance => ({
    ...buildBalance({
      feature: normalizedFeature || String(feature || ""),
      cost: 0,
      allowance: 0,
      used: 0,
      oneTime: false,
      now,
    }),
    allowed: true,
  });

  if (!normalizedFeature) {
    logger.error("Credit check called with an unknown feature", null, { feature });
    return openState();
  }

  try {
    return await computeMediaCreditBalance({ mobileUserId, feature: normalizedFeature, costOverride });
  } catch (error) {
    logger.error("Credit lookup failed; allowing the request", error, {
      mobileUserId,
      feature: normalizedFeature,
    });
    return openState();
  }
}

/** The X-Credits-* set every successful paid response carries (no Retry-After: that is a 429's). */
export function creditBalanceHeaderValues(balance: MediaCreditBalance): Record<string, string> {
  return {
    "X-Credits-Feature": balance.feature,
    "X-Credits-Cost": String(balance.cost),
    "X-Credits-Allowance": String(balance.allowance),
    "X-Credits-Remaining": String(balance.remaining),
    ...(balance.resetAtIso ? { "X-Credits-Reset": balance.resetAtIso } : {}),
  };
}

/**
 * Wallet headers for a SUCCESSFUL run, so the app never has to ask "what's left?" after an AI
 * call — the answer rides the same response. Deliberately without `Retry-After`, which only
 * means something on the 429 refusal that [createCreditHeaders] builds.
 *
 * Read the balance AFTER charging, so `X-Credits-Remaining` is the post-run figure. When the
 * wallet cannot be read the headers are OMITTED: the old fail-open zero balance went out as
 * `X-Credits-Remaining: 0` and the app showed an empty wallet after a successful run.
 */
export async function creditBalanceHeaders({
  mobileUserId,
  feature,
}: {
  mobileUserId: string;
  feature: string;
}): Promise<Record<string, string>> {
  try {
    return creditBalanceHeaderValues(await computeMediaCreditBalance({ mobileUserId, feature }));
  } catch (error) {
    // A run that succeeded must never fail because we could not price the wallet afterwards.
    logger.error("Post-run credit balance lookup failed", error, { mobileUserId, feature });
    return {};
  }
}

/**
 * The caller's wallet for endpoints that merely CARRY it — the AI tools catalogue and mobile
 * app-settings — rather than spending it.
 *
 * ★These two are the app's regular round trips, so riding along on them keeps every screen's
 * balance current without a dedicated request (2026-09-08 direction). Returns null for a
 * signed-out caller: an absent `credits` field reads as "unknown", which is exactly right,
 * while a zeroed one would read as "you are out".
 */
export async function optionalCreditSummary(
  request: NextRequest
): Promise<Awaited<ReturnType<typeof getUserCreditSummary>> | null> {
  try {
    // resolveOptionalMobileBearer, not the 401-shaped resolver: a missing or expired token here
    // means "no wallet to attach", never an error for the response this is riding on.
    const mobileUser = await resolveOptionalMobileBearer(request);
    if (!mobileUser?.id) return null;
    return await getUserCreditSummary(mobileUser.id);
  } catch (error) {
    // This is a passenger on someone else's response; it must never sink it.
    logger.error("Optional credit summary failed", error);
    return null;
  }
}

export function createCreditHeaders(balance: MediaCreditBalance): Record<string, string> {
  return {
    "Retry-After": String(balance.retryAfterSeconds),
    "X-Credits-Feature": balance.feature,
    "X-Credits-Cost": String(balance.cost),
    "X-Credits-Allowance": String(balance.allowance),
    "X-Credits-Remaining": String(balance.remaining),
    // Omitted entirely on a one-time grant rather than sent empty: an absent
    // header reads as "no reset", an empty one reads as a bug.
    ...(balance.resetAtIso ? { "X-Credits-Reset": balance.resetAtIso } : {}),
  };
}

/**
 * Route guard: returns a ready-to-return 429 when the user cannot afford the run,
 * or `null` when it may proceed.
 *
 *   const denied = await enforceMediaCredits({ mobileUserId, feature: "edit-image" });
 *   if (denied) return attachRequestIdHeader(denied, requestId);
 *
 * The body carries `code: "insufficient_credits"` so clients can tell an empty
 * wallet (show the upgrade screen) apart from the burst rate limiter, which
 * returns 429 without that code.
 */
export async function enforceMediaCredits({
  mobileUserId,
  feature,
  message,
  costOverride = null,
}: EnforceOptions): Promise<NextResponse | null> {
  const balance = await checkMediaCredits({ mobileUserId, feature, costOverride });
  if (balance.allowed) return null;
  return insufficientCreditsResponse(balance, message);
}

/** The 429 `insufficient_credits` refusal — one shape for the guard and the reservation. */
export function insufficientCreditsResponse(balance: MediaCreditBalance, message?: string): NextResponse {
  return NextResponse.json(
    {
      error:
        message ||
        "You do not have enough credits for this action. Your balance resets at the start of next month.",
      code: "insufficient_credits",
      credits: {
        feature: balance.feature,
        cost: balance.cost,
        allowance: balance.allowance,
        used: balance.used,
        remaining: balance.remaining,
        resetAt: balance.resetAtIso,
      },
    },
    {
      status: 429,
      headers: {
        ...createCreditHeaders(balance),
        "Cache-Control": "no-store",
      },
    }
  );
}

/**
 * Records one successful run and deducts its credits. Call this only after the
 * provider returns a result: a failed prediction must not cost the user credits.
 *
 * Never throws — a bookkeeping failure must not fail a request whose work already
 * succeeded and was already paid for.
 */
export async function recordMediaUsage({
  mobileUserId,
  feature,
  model = null,
  provider = null,
  credits = null,
  costMicros = null,
}: RecordOptions): Promise<void> {
  const normalizedFeature = normalizeMediaCreditFeature(feature);
  if (!normalizedFeature) {
    logger.error("Usage record skipped: unknown feature", null, { feature });
    return;
  }

  try {
    const settings = await getMobileAppSettings();

    // Both overrides are nullable, and Number(null) === 0 passes Number.isFinite —
    // check for an explicit value before falling back to the configured tables.
    const hasExplicitCredits =
      credits !== null && credits !== undefined && Number.isFinite(Number(credits));
    const hasExplicitCost =
      costMicros !== null && costMicros !== undefined && Number.isFinite(Number(costMicros));

    await prisma.mediaUsage.create({
      data: {
        mobileUserId,
        feature: normalizedFeature,
        provider: provider ? String(provider) : null,
        model: model ? String(model) : null,
        credits: hasExplicitCredits
          ? Math.max(0, Math.floor(Number(credits)))
          : resolveCreditCost(settings, normalizedFeature),
        costMicros: hasExplicitCost
          ? Math.max(0, Math.floor(Number(costMicros)))
          : resolveModelPriceMicros(settings, model || ""),
        periodKey: resolvePeriodKey(),
      },
    });
  } catch (error) {
    logger.error("Failed to record media usage", error, {
      mobileUserId,
      feature: normalizedFeature,
      model,
    });
  }
}

// ---------------------------------------------------------------------------------------------
// Reservations (production audit H-13 / ROB-05)
// ---------------------------------------------------------------------------------------------
// The paid routes used to read the balance, run the provider, and record usage AFTER the fact:
// two overlapping runs both passed the read-only check and overdrew the wallet, and a run whose
// client had already left (Back, cancel, iOS suspension, timeout) was still charged.
//
// Now the usage row IS the hold. It is inserted — with the run's credits — inside a transaction
// that first locks the user's row, BEFORE the provider is called. A concurrent run queues on that
// lock and its SUM then already includes this hold, so the wallet cannot be overdrawn. The row is
// finalized (provider/model/cost) when the run succeeds and deleted — a full refund — when it
// fails, times out, or the client leaves before the response is delivered
// (src/lib/media/credits/paidRun.server.ts orchestrates that). No schema change: an unfinished
// hold is simply a row whose provider is still MEDIA_CREDIT_RESERVATION_PROVIDER.

/** `provider` of a usage row that is still a hold (run not finished). */
export const MEDIA_CREDIT_RESERVATION_PROVIDER = "reserved";

// A hold this old belongs to a process that died mid-run (the longest paid route allows 300 s);
// the user's next reservation releases it rather than keeping their credits forever.
const ORPHANED_RESERVATION_AGE_MS = 15 * 60_000;

export type MediaCreditReservation = {
  /** MediaUsage row id holding the credits. */
  id: string;
  mobileUserId: string;
  feature: string;
  credits: number;
  periodKey: string;
};

export type ReserveMediaCreditsResult =
  | {
      ok: true;
      reservation: MediaCreditReservation;
      /** The wallet AFTER the hold — what X-Credits-Remaining reports. */
      balance: MediaCreditBalance;
      /** The feature's configured per-run cost (what X-Credits-Cost has always reported). */
      featureCost: number;
    }
  | { ok: false; balance: MediaCreditBalance };

/**
 * Atomically checks the wallet and takes this run's credits. Returns `ok: false` with the
 * balance when the run does not fit (the caller answers 429). THROWS when the database cannot be
 * used — a run that cannot be billed must not run, so the caller answers 503 instead of the old
 * fail-open behaviour.
 */
export async function reserveMediaCredits({
  mobileUserId,
  feature,
  costOverride = null,
}: {
  mobileUserId: string;
  feature: string;
  costOverride?: number | null;
}): Promise<ReserveMediaCreditsResult> {
  const normalizedFeature = normalizeMediaCreditFeature(feature);
  if (!normalizedFeature) throw new Error(`Unknown media credit feature: ${String(feature)}`);

  const now = new Date();
  const periodKey = resolvePeriodKey(now);
  const settings = await getMobileAppSettings();
  const cost = resolveRunCost(settings, normalizedFeature, costOverride);
  const featureCost = resolveCreditCost(settings, normalizedFeature);

  return prisma.$transaction(async (tx: any) => {
    // One writer per wallet: a second run for the same user waits here until this transaction
    // commits, and READ COMMITTED then shows it this hold in the SUM below.
    // Row: { creditAllowance: number | null, subscriptionTier, subscriptionExpiresAt }.
    const locked: any[] = await tx.$queryRaw`
      SELECT "creditAllowance", "subscriptionTier", "subscriptionExpiresAt"
      FROM "MobileUser"
      WHERE "id" = ${mobileUserId}::uuid
      FOR UPDATE
    `;
    const user = locked[0];
    if (!user) throw new Error("Mobile user not found for a credit reservation.");

    const orphaned = await tx.mediaUsage.deleteMany({
      where: {
        mobileUserId,
        provider: MEDIA_CREDIT_RESERVATION_PROVIDER,
        createdAt: { lt: new Date(now.getTime() - ORPHANED_RESERVATION_AGE_MS) },
      },
    });
    if (orphaned.count > 0) {
      logger.warn("Released orphaned credit reservations", { mobileUserId, count: orphaned.count });
    }

    const tier = resolveUserTier(user, now);
    const oneTime = isOneTimeAllowanceTier(tier);
    const aggregate = await tx.mediaUsage.aggregate({
      where: oneTime ? { mobileUserId } : { mobileUserId, periodKey },
      _sum: { credits: true },
    });
    const used = Number(aggregate._sum.credits || 0);
    const allowance = resolveMonthlyAllowance(settings, {
      userAllowance: user.creditAllowance ?? null,
      tier,
    });
    const balance = buildBalance({ feature: normalizedFeature, cost, allowance, used, oneTime, now });
    if (!balance.allowed) return { ok: false as const, balance };

    const row = await tx.mediaUsage.create({
      data: {
        mobileUserId,
        feature: normalizedFeature,
        provider: MEDIA_CREDIT_RESERVATION_PROVIDER,
        model: null,
        credits: cost,
        costMicros: 0,
        periodKey,
      },
      select: { id: true },
    });

    return {
      ok: true as const,
      reservation: { id: row.id, mobileUserId, feature: normalizedFeature, credits: cost, periodKey },
      balance: buildBalance({
        feature: normalizedFeature,
        cost: featureCost,
        allowance,
        used: used + cost,
        oneTime,
        now,
      }),
      featureCost,
    };
  });
}

/**
 * Turns a hold into the run's permanent usage row (provider, model, provider cost). The credits
 * were already taken by the reservation. Never throws: the run has succeeded and is being
 * delivered; a bookkeeping failure only leaves the row marked as a hold.
 */
export async function finalizeMediaCreditReservation(
  reservation: MediaCreditReservation,
  {
    provider = null,
    model = null,
    costMicros = null,
  }: { provider?: string | null; model?: string | null; costMicros?: number | null } = {}
): Promise<boolean> {
  try {
    const hasExplicitCost =
      costMicros !== null && costMicros !== undefined && Number.isFinite(Number(costMicros));
    const micros = hasExplicitCost
      ? Math.max(0, Math.floor(Number(costMicros)))
      : resolveModelPriceMicros(await getMobileAppSettings(), model || "");
    const { count } = await prisma.mediaUsage.updateMany({
      where: { id: reservation.id },
      data: {
        // Never leave the hold marker on a finished run, even when the route reports no provider.
        provider: provider ? String(provider) : "unknown",
        model: model ? String(model) : null,
        costMicros: micros,
      },
    });
    if (count === 0) {
      logger.error("Finalized a credit reservation that no longer exists", null, {
        reservationId: reservation.id,
        mobileUserId: reservation.mobileUserId,
        feature: reservation.feature,
      });
    }
    return count > 0;
  } catch (error) {
    logger.error("Failed to finalize a credit reservation", error, {
      reservationId: reservation.id,
      mobileUserId: reservation.mobileUserId,
      feature: reservation.feature,
    });
    return false;
  }
}

/**
 * Releases a hold — the full refund for a run the user did not get (provider failure, timeout,
 * client gone before delivery). Idempotent and never throws; a hold that cannot be released now
 * is released by the orphan sweep in the user's next reservation.
 */
export async function refundMediaCreditReservation(
  reservation: MediaCreditReservation,
  reason: string
): Promise<boolean> {
  try {
    const { count } = await prisma.mediaUsage.deleteMany({ where: { id: reservation.id } });
    logger.info("Credit reservation refunded", {
      reservationId: reservation.id,
      mobileUserId: reservation.mobileUserId,
      feature: reservation.feature,
      credits: reservation.credits,
      reason,
      released: count > 0,
    });
    return count > 0;
  } catch (error) {
    logger.error("Failed to refund a credit reservation", error, {
      reservationId: reservation.id,
      mobileUserId: reservation.mobileUserId,
      feature: reservation.feature,
      credits: reservation.credits,
      reason,
    });
    return false;
  }
}

/**
 * A user's wallet summary for the current period — what the mobile app shows as
 * "credits left", plus the price list so the client can label each action.
 */
export async function getUserCreditSummary(mobileUserId: string) {
  const now = new Date();
  const periodKey = resolvePeriodKey(now);
  const resetAt = resolvePeriodResetAt(now);

  const [settings, user] = await Promise.all([
    getMobileAppSettings(),
    prisma.mobileUser.findUnique({
      where: { id: mobileUserId },
      select: { creditAllowance: true, subscriptionTier: true, subscriptionExpiresAt: true },
    }),
  ]);

  const tier = resolveUserTier(user);
  const oneTime = isOneTimeAllowanceTier(tier);
  const used = await sumCreditsUsed(mobileUserId, periodKey, { lifetime: oneTime });
  const allowance = resolveMonthlyAllowance(settings, {
    userAllowance: user?.creditAllowance ?? null,
    tier,
  });

  return {
    allowance,
    used,
    remaining: Math.max(0, allowance - used),
    tier,
    /** False for the free tier: its credits are granted once and never refill. */
    renews: !oneTime,
    periodKey,
    // Null when nothing will refill — the app must not promise a reset that
    // is never going to happen.
    resetAt: oneTime ? null : resetAt.toISOString(),
    // Settings come from an untyped JS module — restate the shape so callers get
    // a usable index signature instead of `{}`.
    costs: (settings.mediaCredits?.costs || {}) as Record<string, number>,
  };
}

/**
 * AI usage for the admin dashboard: which features and models are actually being
 * used, what they cost, and the daily trend.
 *
 * Fails soft — this is one card on a page full of other stats, so a missing table
 * (migration not applied yet) must not take the whole stats endpoint down.
 */
// Micro-dollars divide into repeating binary fractions (71_000 → 0.07100000000000001).
// Round once here so every figure the dashboard renders is already clean.
function microsToUsd(micros: unknown): number {
  return Number((Number(micros || 0) / 1_000_000).toFixed(6));
}

export async function getMediaUsageStats({ trendDays = 30 } = {}) {
  const empty = {
    available: false,
    periodKey: resolvePeriodKey(),
    totals: { runs: 0, credits: 0, costUsd: 0, activeUsers: 0 },
    byFeature: [] as Array<{ feature: string; runs: number; credits: number; costUsd: number }>,
    byModel: [] as Array<{ model: string; runs: number; costUsd: number }>,
    trend: [] as Array<{ day: string; runs: number; costUsd: number }>,
  };

  try {
    const periodKey = resolvePeriodKey();
    const days = Math.max(1, Math.min(90, Math.floor(trendDays)));

    const [featureRows, modelRows, activeUsers, trendRows] = await Promise.all([
      prisma.mediaUsage.groupBy({
        by: ["feature"],
        where: { periodKey },
        _count: { _all: true },
        _sum: { costMicros: true, credits: true },
      }) as Promise<FeatureGroupRow[]>,
      prisma.mediaUsage.groupBy({
        by: ["model"],
        where: { periodKey },
        _count: { _all: true },
        _sum: { costMicros: true },
      }) as Promise<ModelGroupRow[]>,
      // Distinct users who ran at least one AI action this period.
      prisma.mediaUsage
        .findMany({
          where: { periodKey },
          select: { mobileUserId: true },
          distinct: ["mobileUserId"],
        })
        .then((rows: Array<{ mobileUserId: string }>) => rows.length),
      // float8, not int: SUM over a busy month easily exceeds int32 (1M runs at
      // 40_000 micros is 4e10), and float8 also avoids BigInt in the JSON payload.
      prisma.$queryRaw<Array<{ day: Date; runs: number; cost_micros: number }>>`
        SELECT date_trunc('day', "createdAt")::date AS day,
               COUNT(*)::int AS runs,
               COALESCE(SUM("costMicros"), 0)::float8 AS cost_micros
        FROM "MediaUsage"
        WHERE "createdAt" >= NOW() - make_interval(days => ${days}::int)
        GROUP BY 1
        ORDER BY 1 ASC
      `,
    ]);

    const byFeature = featureRows
      .map((row) => ({
        feature: row.feature,
        runs: row._count._all,
        credits: Number(row._sum.credits || 0),
        costUsd: microsToUsd(row._sum.costMicros),
      }))
      .sort((a, b) => b.costUsd - a.costUsd || b.runs - a.runs);

    const byModel = modelRows
      .map((row) => ({
        model: row.model || "unknown",
        runs: row._count._all,
        costUsd: microsToUsd(row._sum.costMicros),
      }))
      .sort((a, b) => b.costUsd - a.costUsd || b.runs - a.runs);

    return {
      available: true,
      periodKey,
      totals: {
        runs: byFeature.reduce((sum, row) => sum + row.runs, 0),
        credits: byFeature.reduce((sum, row) => sum + row.credits, 0),
        costUsd: Number(byFeature.reduce((sum, row) => sum + row.costUsd, 0).toFixed(6)),
        activeUsers,
      },
      byFeature,
      byModel,
      trend: trendRows.map((row: { day: Date; runs: number; cost_micros: number }) => ({
        day: new Date(row.day).toISOString().slice(0, 10),
        runs: Number(row.runs || 0),
        costUsd: microsToUsd(row.cost_micros),
      })),
    };
  } catch (error) {
    logger.error("Failed to build AI usage stats", error);
    return empty;
  }
}

/**
 * Spend and volume per feature for a period — the data behind "where is the
 * provider bill going". Pass `mobileUserId` to scope it to one account.
 */
export async function getMediaUsageSummary({
  periodKey = resolvePeriodKey(),
  mobileUserId,
}: {
  periodKey?: string;
  mobileUserId?: string;
} = {}) {
  const grouped = (await prisma.mediaUsage.groupBy({
    by: ["feature", "model"],
    where: {
      periodKey,
      ...(mobileUserId ? { mobileUserId } : {}),
    },
    _count: { _all: true },
    _sum: { costMicros: true, credits: true },
  })) as UsageGroupRow[];

  const rows = grouped
    .map((row) => ({
      feature: row.feature,
      model: row.model,
      runs: row._count._all,
      credits: Number(row._sum.credits || 0),
      costMicros: Number(row._sum.costMicros || 0),
      costUsd: Number(row._sum.costMicros || 0) / 1_000_000,
    }))
    .sort((a, b) => b.costMicros - a.costMicros);

  return {
    periodKey,
    rows,
    totalRuns: rows.reduce((sum, row) => sum + row.runs, 0),
    totalCredits: rows.reduce((sum, row) => sum + row.credits, 0),
    totalCostUsd: rows.reduce((sum, row) => sum + row.costUsd, 0),
  };
}
