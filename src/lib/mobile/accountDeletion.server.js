import prisma from "@/lib/prisma";
import { logger } from "@/lib/logging/logger";

/**
 * Google Play and the App Store both require an in-app path that erases the
 * account and the personal data hanging off it. This is that erase.
 *
 * Everything keyed to the MobileUser row is removed by the schema's
 * `onDelete: Cascade` relations — identities, refresh tokens, device tokens,
 * favorites, media usage and subscription records all go with the row.
 *
 * ContactMessage is the one exception: it is `onDelete: SetNull`, deliberately,
 * so an open support thread is not silently destroyed mid-conversation. That
 * leaves the name, email, IP and user agent copied onto the message itself, so
 * those columns are scrubbed here before the user row goes. The thread survives
 * for the support inbox; the person behind it does not.
 *
 * NOTE: this does not cancel a live store subscription. Apple and Google own
 * that state and only the user can cancel it from their store account, which is
 * why the app's confirmation dialog says so before calling this.
 *
 * @param {string} mobileUserId
 * @returns {Promise<{ contactMessagesAnonymized: number }>}
 */
export async function deleteMobileUserAccount(mobileUserId) {
  const userId = String(mobileUserId || "").trim();
  if (!userId) {
    throw new Error("A user id is required to delete an account.");
  }

  const result = await prisma.$transaction(async (tx) => {
    const anonymized = await tx.contactMessage.updateMany({
      where: { mobileUserId: userId },
      data: {
        name: "Deleted account",
        email: "",
        ipAddress: null,
        userAgent: null,
      },
    });

    // Cascades to identities, refresh tokens, device tokens, favorites,
    // media usage and subscriptions.
    await tx.mobileUser.delete({ where: { id: userId } });

    return { contactMessagesAnonymized: anonymized.count };
  });

  logger.info("Mobile account deleted", {
    contactMessagesAnonymized: result.contactMessagesAnonymized,
  });

  return result;
}
