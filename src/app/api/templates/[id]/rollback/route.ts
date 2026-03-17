import { NextRequest, NextResponse } from "next/server";

import prisma from "@/lib/prisma";
import { buildSnapshot, canAccessTemplate, getEditorSession } from "@/lib/templates/server";
import { handleApiError, handleBadRequest, handleNotFound, handleForbidden } from "@/lib/api/errors";
import { logger } from "@/lib/logging/logger";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const session = await getEditorSession();
    if (session.error) return session.error;

    const resolvedParams = await params;
    const templateId = resolvedParams?.id;
    if (!templateId) {
      return handleBadRequest("Missing template id");
    }

    let body: any = {};
    try {
      body = await request.json();
    } catch (_error) {
      return handleBadRequest("Invalid JSON body");
    }

    const revisionId = typeof body?.revisionId === "string" ? body.revisionId : "";
    if (!revisionId) {
      return handleBadRequest("Missing revision id");
    }

    const template = await prisma.template.findUnique({ where: { id: templateId } });
    if (!template) {
      return handleNotFound("Template not found");
    }
    if (!canAccessTemplate(session, template)) {
      return handleForbidden("Cannot rollback this template");
    }

    const revision = await prisma.templateRevision.findFirst({
      where: { id: revisionId, templateId },
      select: { snapshot: true },
    });

    if (!revision) {
      return handleNotFound("Revision not found");
    }

    const snapshot = revision.snapshot || {};

    logger.info("Rolling back template", {
      userId: session.userId,
      templateId,
      revisionId,
    });

    const rolledBack = await prisma.$transaction(async (tx: any) => {
      const item = await tx.template.update({
        where: { id: templateId },
        data: {
          name: typeof snapshot.name === "string" ? snapshot.name : template.name,
          slug: typeof snapshot.slug === "string" ? snapshot.slug : template.slug,
          status: typeof snapshot.status === "string" ? snapshot.status : template.status,
          canvasSize: snapshot.canvasSize ?? template.canvasSize,
          category: typeof snapshot.category === "string" ? snapshot.category : template.category,
          subCategory:
            typeof snapshot.subCategory === "string" ? snapshot.subCategory : template.subCategory,
          tags: Array.isArray(snapshot.tags) ? snapshot.tags : template.tags,
          thumbnailDataUrl:
            typeof snapshot.thumbnailDataUrl === "string"
              ? snapshot.thumbnailDataUrl
              : template.thumbnailDataUrl,
          data: snapshot.data ?? template.data,
          publishedAt: snapshot.status === "published" ? new Date() : null,
          version: { increment: 1 },
        },
      });

      await tx.templateRevision.create({
        data: {
          templateId: item.id,
          version: item.version,
          action: "rollback",
          actorId: session.userId,
          snapshot: buildSnapshot(item),
        },
      });

      return item;
    });

    return NextResponse.json({ template: rolledBack });
  } catch (error) {
    return handleApiError(error, "Failed to rollback template");
  }
}
