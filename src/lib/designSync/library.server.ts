import type { Prisma } from "@prisma/client";

import { db as prisma } from "./db";

/**
 * Runs one sync write for a user under that user's library lock.
 *
 * ★Every write to a user's designs, folders or media goes through here. The `SELECT … FOR UPDATE`
 * on the user's UserDesignLibrary row does two jobs:
 *  - it makes `changeSeq` gap-free and commit-ordered — a device that pulled "everything after N"
 *    can never miss a change that was numbered below N but committed later (which a plain
 *    database sequence allows);
 *  - it serialises quota checks, so two uploads racing for the last free megabyte cannot both fit.
 *
 * `nextSeq()` hands out the next number; stamp it on every row the write changes.
 */
export async function withLibraryLock<T>(
  mobileUserId: string,
  work: (tx: Prisma.TransactionClient, nextSeq: () => bigint) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`
        INSERT INTO "UserDesignLibrary" ("mobileUserId", "changeSeq", "updatedAt")
        VALUES (${mobileUserId}::uuid, 0, NOW())
        ON CONFLICT ("mobileUserId") DO NOTHING`;
      const rows = await tx.$queryRaw<Array<{ changeSeq: bigint }>>`
        SELECT "changeSeq" FROM "UserDesignLibrary"
        WHERE "mobileUserId" = ${mobileUserId}::uuid
        FOR UPDATE`;
      const start = BigInt(rows[0]?.changeSeq ?? 0);
      let seq = start;
      const nextSeq = () => {
        seq += BigInt(1);
        return seq;
      };
      const result = await work(tx, nextSeq);
      if (seq !== start) {
        await tx.userDesignLibrary.update({
          where: { mobileUserId },
          data: { changeSeq: seq },
        });
      }
      return result;
    },
    { maxWait: 10_000, timeout: 30_000 },
  );
}
