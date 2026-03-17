import { NextRequest, NextResponse } from "next/server";

import prisma from "@/lib/prisma";
import { canAccessTemplate, getEditorSession } from "@/lib/templates/server";
import { handleApiError, handleBadRequest, handleNotFound, handleForbidden } from "@/lib/api/errors";
import { logger } from "@/lib/logging/logger";

export async function GET(
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

    const template = await prisma.template.findUnique({ where: { id: templateId } });
    if (!template) {
      return handleNotFound("Template not found");
    }
    if (!canAccessTemplate(session, template)) {
      return handleForbidden("Cannot view this template's history");
    }

    const limit = Math.min(Math.max(Number(new URL(request.url).searchParams.get("limit") || 25), 1), 100);

    logger.info("Fetching template history", {
      userId: session.userId,
      templateId,
      limit,
    });

    const revisions = await prisma.templateRevision.findMany({
      where: { templateId },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        version: true,
        action: true,
        createdAt: true,
        actorId: true,
        snapshot: true,
      },
    });

    return NextResponse.json({ revisions });
  } catch (error) {
    return handleApiError(error, "Failed to fetch template history");
  }
}
