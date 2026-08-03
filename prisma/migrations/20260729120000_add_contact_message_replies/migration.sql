-- Support reply thread. One row per outbound email sent from the dashboard
-- inbox in answer to a ContactMessage.
--
-- Rows are written whether or not delivery succeeded ("status" = sent|failed,
-- with "error" carrying the SMTP failure) so an admin can see that a reply was
-- attempted instead of losing the draft to a transient mail outage.
--
-- "messageId"/"inReplyTo" hold the RFC 5322 headers stamped on the outgoing
-- mail. Chaining each reply to the previous one is what makes the customer's
-- mail client group the exchange into a single conversation.
--
-- ON DELETE CASCADE: deleting a contact message drops its thread with it —
-- the replies have no meaning without the message that prompted them.

-- AlterTable
ALTER TABLE "ContactMessage" ADD COLUMN "lastRepliedAt" TIMESTAMPTZ;

-- CreateTable
CREATE TABLE "ContactMessageReply" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "contactMessageId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "fromEmail" TEXT NOT NULL,
    "toEmail" TEXT NOT NULL,
    "authorUserId" UUID,
    "authorName" TEXT NOT NULL,
    "messageId" TEXT,
    "inReplyTo" TEXT,
    "status" TEXT NOT NULL DEFAULT 'sent',
    "error" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactMessageReply_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContactMessageReply_contactMessageId_createdAt_idx"
    ON "ContactMessageReply"("contactMessageId", "createdAt");

-- CreateIndex
CREATE INDEX "ContactMessageReply_status_idx" ON "ContactMessageReply"("status");

-- AddForeignKey
ALTER TABLE "ContactMessageReply"
    ADD CONSTRAINT "ContactMessageReply_contactMessageId_fkey"
    FOREIGN KEY ("contactMessageId") REFERENCES "ContactMessage"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
