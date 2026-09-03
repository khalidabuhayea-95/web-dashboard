// Shared dedupe/attempt bookkeeping for store webhooks. Both stores redeliver:
// Apple retries server notifications it saw fail, Pub/Sub redelivers until it
// gets a 2xx — and both can also double-deliver a success. The ledger row
// (keyed by the store's own notification id) makes processing exactly-once-ish:
// a concurrent duplicate loses the insert race and is answered 200 without
// running, a redelivery of a failure retries the work, and a redelivery of a
// success is acknowledged without side effects.

import { Prisma } from "@prisma/client";

import { createLogger } from "@/lib/logging/logger";
import prisma from "@/lib/prisma";

const logger = createLogger("billing.notifications");

export type NotificationOutcome = "processed" | "skipped";

export type ProcessNotificationInput = {
  /** The store's notification id (Apple notificationUUID / Pub/Sub messageId). */
  id: string;
  platform: "apple" | "google";
  type: string;
  payload: unknown;
  /** Does the actual state change. Return "skipped" for benign no-ops; throw to fail. */
  process: () => Promise<NotificationOutcome>;
};

export type ProcessNotificationResult = {
  /** HTTP status the webhook should answer with. */
  httpStatus: number;
  outcome: NotificationOutcome | "duplicate" | "failed";
};

export async function processStoreNotification(
  input: ProcessNotificationInput,
): Promise<ProcessNotificationResult> {
  const { id, platform, type } = input;
  const payload = (input.payload ?? {}) as Prisma.InputJsonValue;

  if (!id) {
    // No stable id to dedupe on — process without a ledger row rather than
    // dropping the event. Only malformed envelopes land here.
    const outcome = await input.process();
    return { httpStatus: 200, outcome };
  }

  try {
    await prisma.storeNotification.create({
      data: { id, platform, type, payload, status: "processing" },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await prisma.storeNotification.findUnique({ where: { id } });
      if (!existing || existing.status !== "failed") {
        // Already handled (or being handled by a concurrent delivery).
        return { httpStatus: 200, outcome: "duplicate" };
      }
      await prisma.storeNotification.update({
        where: { id },
        data: { status: "processing", attempts: { increment: 1 }, error: null },
      });
    } else {
      throw error;
    }
  }

  try {
    const outcome = await input.process();
    await prisma.storeNotification.update({
      where: { id },
      data: { status: outcome, processedAt: new Date(), error: null },
    });
    return { httpStatus: 200, outcome };
  } catch (error) {
    logger.error("Store notification processing failed", error, { id, platform, type });
    await prisma.storeNotification
      .update({
        where: { id },
        data: { status: "failed", error: String(error).slice(0, 2000) },
      })
      .catch(() => undefined);
    // Non-2xx makes the store redeliver, which lands on the retry branch above.
    return { httpStatus: 500, outcome: "failed" };
  }
}
