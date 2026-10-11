/**
 * One paid AI run, billed only for a result the client actually receives (production audit
 * H-13 / ROB-05).
 *
 *   1. Idempotency-Key (optional): a retry of a run that already succeeded replays its response;
 *      a retry of a run still going gets 409; see ./idempotency.server.ts.
 *   2. Reserve: the credits are taken atomically BEFORE the provider is called (429 when the
 *      wallet cannot cover it, 503 when the database cannot be used — a run that cannot be billed
 *      does not run).
 *   3. Run, raced against the client leaving and a deadline.
 *   4. Settle: success finalizes the hold and returns the response; provider failure, timeout,
 *      or the client leaving before the response is DELIVERED releases the hold — a full refund.
 *
 * "Delivered" is Next's own definition: `request.signal` aborts when the socket closes before the
 * response finished writing (next/dist/server/web/spec-extension/adapters/next-request.js,
 * signalFromNodeResponse), so a download cut off by an iOS suspension refunds too.
 *
 * Provider errors are re-thrown after the refund so each route keeps its own error mapping.
 */
import { NextResponse } from "next/server";

import { serviceUnavailableResponse } from "@/lib/api/infrastructureErrors";
import {
  type MediaCreditReservation,
  creditBalanceHeaderValues,
  creditBalanceHeaders,
  finalizeMediaCreditReservation,
  insufficientCreditsResponse,
  refundMediaCreditReservation,
  reserveMediaCredits,
} from "@/lib/media/credits/index.server";
import {
  abandonIdempotentRun,
  beginIdempotentRun,
  completeIdempotentRun,
  idempotencyStoreKey,
  idempotentRunWasReplayed,
  readIdempotencyKey,
} from "@/lib/media/credits/idempotency.server";

type RouteLogger = {
  info: (message: string, context?: Record<string, unknown>) => void;
  warn: (message: string, context?: Record<string, unknown>) => void;
  error: (message: string, error?: unknown, context?: Record<string, unknown>) => void;
};

export type PaidRunResponse = {
  /** Usage-row metadata for the spend report. */
  usage: { provider?: string | null; model?: string | null; costMicros?: number | null };
  status?: number;
  /** Route headers (Content-Type, X-…); the X-Credits-* wallet set and no-store are added here. */
  headers: Record<string, string>;
  body: Uint8Array;
};

export type PaidRunContext = {
  /** Credits this run took (the reservation) — what X-Credits-Charged reports. */
  chargedCredits: number;
};

export type RunPaidMediaOperationOptions<T> = {
  request: Request;
  logger: RouteLogger;
  mobileUserId: string;
  feature: string;
  costOverride?: number | null;
  /** Namespaces Idempotency-Keys per route. */
  idempotencyScope: string;
  /** What the run is (tool id, model…): a key reused for a different run is refused (422). */
  fingerprint: string;
  /** Give up (and refund) after this long; keep it under the route's maxDuration. */
  timeoutMs: number;
  insufficientCreditsMessage?: string;
  /** The provider call. `signal` aborts when the client leaves or the deadline passes. */
  execute: (signal: AbortSignal) => Promise<T>;
  /** Builds the success response from the provider result. Runs only for a run that is billed. */
  respond: (result: T, context: PaidRunContext) => PaidRunResponse | Promise<PaidRunResponse>;
};

type RunOutcome<T> =
  | { kind: "ok"; value: T }
  | { kind: "error"; error: unknown }
  | { kind: "timeout" }
  | { kind: "aborted" };

const NO_STORE = { "Cache-Control": "no-store" } as const;
const IN_PROGRESS_RETRY_AFTER_SECONDS = 3;

function jsonNoStore(payload: Record<string, unknown>, status: number, headers: Record<string, string> = {}) {
  return NextResponse.json(payload, { status, headers: { ...NO_STORE, ...headers } });
}

/** Races the provider call against the client leaving and the deadline. Never rejects. */
function raceProviderRun<T>(
  execute: (signal: AbortSignal) => Promise<T>,
  { clientSignal, timeoutMs, onLateSettle }: {
    clientSignal: AbortSignal | null;
    timeoutMs: number;
    onLateSettle: (outcome: "fulfilled" | "rejected") => void;
  }
): Promise<RunOutcome<T>> {
  return new Promise((resolve) => {
    const controller = new AbortController();
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (outcome: RunOutcome<T>) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      clientSignal?.removeEventListener("abort", onClientAbort);
      if (outcome.kind === "timeout" || outcome.kind === "aborted") controller.abort();
      resolve(outcome);
    };
    const onClientAbort = () => finish({ kind: "aborted" });

    if (clientSignal?.aborted) {
      finish({ kind: "aborted" });
      return;
    }
    clientSignal?.addEventListener("abort", onClientAbort, { once: true });
    timer = setTimeout(() => finish({ kind: "timeout" }), Math.max(1, timeoutMs));

    let run: Promise<T>;
    try {
      run = Promise.resolve(execute(controller.signal));
    } catch (error) {
      run = Promise.reject(error);
    }
    // A run the request stopped waiting for still settles in the background; it is observed here
    // (so it is never an unhandled rejection) and reported, since the provider cost was incurred.
    run.then(
      (value) => (settled ? onLateSettle("fulfilled") : finish({ kind: "ok", value })),
      (error) => (settled ? onLateSettle("rejected") : finish({ kind: "error", error }))
    );
  });
}

export async function runPaidMediaOperation<T>({
  request,
  logger,
  mobileUserId,
  feature,
  costOverride = null,
  idempotencyScope,
  fingerprint,
  timeoutMs,
  insufficientCreditsMessage,
  execute,
  respond,
}: RunPaidMediaOperationOptions<T>): Promise<NextResponse> {
  const startedAt = Date.now();
  const clientSignal: AbortSignal | null = request.signal ?? null;

  // 1. Idempotency.
  const idempotencyKey = readIdempotencyKey(request);
  if (!idempotencyKey.ok) {
    return jsonNoStore(
      {
        error: "The Idempotency-Key header must be 8–255 visible ASCII characters (a UUID works).",
        code: "invalid_idempotency_key",
      },
      400
    );
  }
  const storeKey = idempotencyKey.key
    ? idempotencyStoreKey(mobileUserId, idempotencyScope, idempotencyKey.key)
    : null;
  if (storeKey) {
    const begun = beginIdempotentRun(storeKey, fingerprint);
    if (begun.kind === "replay") {
      // The run was billed and delivered once; this copy is free. The wallet headers are re-read
      // so the app's balance is current, the rest is the original response byte for byte.
      const freshWallet = await creditBalanceHeaders({ mobileUserId, feature });
      logger.info("Paid run replayed from its Idempotency-Key", { mobileUserId, feature });
      return new NextResponse(begun.response.body as BodyInit, {
        status: begun.response.status,
        headers: { ...begun.response.headers, ...freshWallet, ...NO_STORE, "Idempotent-Replayed": "true" },
      });
    }
    if (begun.kind === "in_progress") {
      return jsonNoStore(
        {
          error: "This request is still being processed. Retry shortly with the same Idempotency-Key.",
          code: "idempotency_in_progress",
        },
        409,
        { "Retry-After": String(IN_PROGRESS_RETRY_AFTER_SECONDS) }
      );
    }
    if (begun.kind === "mismatch") {
      return jsonNoStore(
        {
          error: "This Idempotency-Key was already used for a different request.",
          code: "idempotency_key_reused",
        },
        422
      );
    }
    if (begun.kind === "spent") {
      return jsonNoStore(
        {
          error: "This request already completed and its result is no longer available. Start a new one.",
          code: "idempotency_key_spent",
        },
        409
      );
    }
  }

  // 2. Reserve.
  let reservation: MediaCreditReservation;
  let walletHeaders: Record<string, string>;
  try {
    const reserved = await reserveMediaCredits({ mobileUserId, feature, costOverride });
    if (!reserved.ok) {
      if (storeKey) abandonIdempotentRun(storeKey);
      logger.info("Paid run rejected: insufficient credits", { mobileUserId, feature });
      return insufficientCreditsResponse(reserved.balance, insufficientCreditsMessage);
    }
    reservation = reserved.reservation;
    walletHeaders = creditBalanceHeaderValues(reserved.balance);
  } catch (error) {
    if (storeKey) abandonIdempotentRun(storeKey);
    logger.error("Credit reservation failed; the run was not started", error, { mobileUserId, feature });
    return serviceUnavailableResponse();
  }

  // From here on the credits are held. Exactly one of finalize / refund settles them; the refund
  // is a single shared promise, so the abort listener and the run's own outcome never double it.
  let releasing: Promise<void> | null = null;
  let delivering = false;
  const isReleased = () => releasing !== null;
  const release = (reason: string): Promise<void> => {
    if (releasing) return releasing;
    releasing = (async () => {
      // A delivery cut short AFTER a retry already received the stored copy was delivered after all.
      if (reason === "delivery_aborted" && storeKey && idempotentRunWasReplayed(storeKey)) {
        logger.info("Delivery aborted after an idempotent replay; the charge stands", { mobileUserId, feature });
        return;
      }
      if (storeKey) abandonIdempotentRun(storeKey);
      await refundMediaCreditReservation(reservation, reason);
    })();
    return releasing;
  };
  // Stays attached for the whole request: an abort AFTER the response object is returned means
  // the body never finished writing, so the user did not get the result. (Once the response has
  // finished, the signal never aborts.)
  const onClientGone = () => {
    void release(delivering ? "delivery_aborted" : "client_aborted");
  };
  clientSignal?.addEventListener("abort", onClientGone, { once: true });

  // 3. Run.
  const outcome = await raceProviderRun(execute, {
    clientSignal,
    timeoutMs,
    onLateSettle: (late) =>
      logger.warn("Paid run settled after the request stopped waiting (provider cost not recovered)", {
        mobileUserId,
        feature,
        late,
        durationMs: Date.now() - startedAt,
      }),
  });

  if (outcome.kind === "error") {
    await release("provider_failed");
    throw outcome.error;
  }
  if (outcome.kind === "timeout") {
    await release("timeout");
    logger.warn("Paid run timed out and was refunded", { mobileUserId, feature, timeoutMs });
    return jsonNoStore(
      { error: "The request took too long and was not charged. Please try again.", code: "ai_run_timeout" },
      504
    );
  }
  if (outcome.kind === "aborted" || clientSignal?.aborted || isReleased()) {
    await release("client_aborted");
    logger.info("Client left before the result; the run was refunded", {
      mobileUserId,
      feature,
      durationMs: Date.now() - startedAt,
    });
    // Nobody is listening; 499 ("client closed request") keeps the access log honest.
    return jsonNoStore({ error: "Request cancelled.", code: "client_closed_request" }, 499);
  }

  // 4. Settle a success.
  let success: PaidRunResponse;
  try {
    success = await respond(outcome.value, { chargedCredits: reservation.credits });
  } catch (error) {
    await release("response_failed");
    throw error;
  }
  if (isReleased()) {
    await release("client_aborted");
    return jsonNoStore({ error: "Request cancelled.", code: "client_closed_request" }, 499);
  }
  await finalizeMediaCreditReservation(reservation, success.usage);

  const status = success.status ?? 200;
  const headers = { ...walletHeaders, ...success.headers, ...NO_STORE };
  if (storeKey && !isReleased()) {
    completeIdempotentRun(storeKey, { status, headers, body: success.body });
  }
  delivering = true;
  return new NextResponse(success.body as BodyInit, { status, headers });
}
