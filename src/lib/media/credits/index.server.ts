import { NextResponse } from "next/server";

import { createLogger } from "@/lib/logging/logger";
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
  resetAtIso: string;
  retryAfterSeconds: number;
};

type EnforceOptions = {
  mobileUserId: string;
  feature: string;
  message?: string;
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

/** Credits already spent by a user in the current period. */
async function sumCreditsUsed(mobileUserId: string, periodKey: string): Promise<number> {
  const aggregate = await prisma.mediaUsage.aggregate({
    where: { mobileUserId, periodKey },
    _sum: { credits: true },
  });
  return Number(aggregate._sum.credits || 0);
}

/**
 * Reads a user's wallet for a given feature: what the run costs, what they have
 * left, and whether it fits.
 *
 * Fails OPEN: if the wallet cannot be read the request is allowed through and the
 * failure is logged as an error. A database blip should not take the AI features
 * offline, and the per-user rate limiter still caps the burst. To fail closed
 * instead, return `allowed: false` from the catch block below.
 */
export async function checkMediaCredits({
  mobileUserId,
  feature,
}: {
  mobileUserId: string;
  feature: string;
}): Promise<MediaCreditBalance> {
  const now = new Date();
  const periodKey = resolvePeriodKey(now);
  const resetAt = resolvePeriodResetAt(now);
  const retryAfterSeconds = Math.max(0, Math.ceil((resetAt.getTime() - now.getTime()) / 1000));
  const normalizedFeature = normalizeMediaCreditFeature(feature);

  const openState = (extra: Partial<MediaCreditBalance> = {}): MediaCreditBalance => ({
    feature: normalizedFeature || String(feature || ""),
    cost: 0,
    allowance: 0,
    used: 0,
    remaining: 0,
    allowed: true,
    periodKey,
    resetAtIso: resetAt.toISOString(),
    retryAfterSeconds,
    ...extra,
  });

  if (!normalizedFeature) {
    logger.error("Credit check called with an unknown feature", null, { feature });
    return openState();
  }

  try {
    const [settings, user, used] = await Promise.all([
      getMobileAppSettings(),
      prisma.mobileUser.findUnique({
        where: { id: mobileUserId },
        select: { creditAllowance: true },
      }),
      sumCreditsUsed(mobileUserId, periodKey),
    ]);

    const cost = resolveCreditCost(settings, normalizedFeature);
    const allowance = resolveMonthlyAllowance(settings, {
      userAllowance: user?.creditAllowance ?? null,
    });
    const remaining = Math.max(0, allowance - used);

    return {
      feature: normalizedFeature,
      cost,
      allowance,
      used,
      remaining,
      // A zero-cost feature is always free to run; otherwise the run must fit in
      // what is left, so a user is never charged into a negative balance.
      allowed: cost === 0 || remaining >= cost,
      periodKey,
      resetAtIso: resetAt.toISOString(),
      retryAfterSeconds,
    };
  } catch (error) {
    logger.error("Credit lookup failed; allowing the request", error, {
      mobileUserId,
      feature: normalizedFeature,
    });
    return openState();
  }
}

export function createCreditHeaders(balance: MediaCreditBalance): Record<string, string> {
  return {
    "Retry-After": String(balance.retryAfterSeconds),
    "X-Credits-Feature": balance.feature,
    "X-Credits-Cost": String(balance.cost),
    "X-Credits-Allowance": String(balance.allowance),
    "X-Credits-Remaining": String(balance.remaining),
    "X-Credits-Reset": balance.resetAtIso,
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
}: EnforceOptions): Promise<NextResponse | null> {
  const balance = await checkMediaCredits({ mobileUserId, feature });
  if (balance.allowed) return null;

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

/**
 * A user's wallet summary for the current period — what the mobile app shows as
 * "credits left", plus the price list so the client can label each action.
 */
export async function getUserCreditSummary(mobileUserId: string) {
  const now = new Date();
  const periodKey = resolvePeriodKey(now);
  const resetAt = resolvePeriodResetAt(now);

  const [settings, user, used] = await Promise.all([
    getMobileAppSettings(),
    prisma.mobileUser.findUnique({
      where: { id: mobileUserId },
      select: { creditAllowance: true },
    }),
    sumCreditsUsed(mobileUserId, periodKey),
  ]);

  const allowance = resolveMonthlyAllowance(settings, {
    userAllowance: user?.creditAllowance ?? null,
  });

  return {
    allowance,
    used,
    remaining: Math.max(0, allowance - used),
    periodKey,
    resetAt: resetAt.toISOString(),
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
