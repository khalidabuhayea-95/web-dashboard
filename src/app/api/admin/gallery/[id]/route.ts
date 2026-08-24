import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getEditorSession } from "@/lib/templates/server";
import {
  deleteObjects,
  getPublicStorageBucketName,
} from "@/lib/storage/objectStorage.server";
import { handleApiError, handleForbidden, handleNotFound } from "@/lib/api/errors";
import { logger } from "@/lib/logging/logger";

export const runtime = "nodejs";

// Removes a gallery image and, best-effort, its stored object. Anything that
// referenced the URL (e.g. a template's before image) keeps its own copy of the
// string — templates snapshot gallery images at generate time, they do not
// link to rows — so deleting here never breaks a template.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getEditorSession();
    if (session.error) return session.error;
    if (session.role !== "admin") {
      return handleForbidden("Only admins can delete gallery images");
    }

    const { id } = await params;
    const existing = await prisma.galleryImage.findUnique({ where: { id } });
    if (!existing) return handleNotFound("Gallery image");

    await prisma.galleryImage.delete({ where: { id } });
    try {
      await deleteObjects(getPublicStorageBucketName(), [existing.storageKey]);
    } catch (cleanupError) {
      logger.warn("Gallery object cleanup failed", {
        key: existing.storageKey,
        error: String(cleanupError),
      });
    }

    logger.info("Gallery image deleted", { userId: session.userId, key: existing.storageKey });
    return NextResponse.json({ ok: true, id });
  } catch (error) {
    return handleApiError(error, "Failed to delete the image");
  }
}
