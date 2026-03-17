import { NextRequest, NextResponse } from "next/server";

import prisma from "@/lib/prisma";
import {
  canAccessTemplate,
  getEditorSession,
} from "@/lib/templates/server";
import {
  handleApiError,
  handleForbidden,
  handleNotFound,
  handleBadRequest,
} from "@/lib/api/errors";
import { logger } from "@/lib/logging/logger";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getEditorSession();
    if (session.error) return session.error;

    const resolvedParams = await params;
    const templateId = resolvedParams?.id;
    
    if (!templateId) {
      return handleBadRequest("Missing template id");
    }

    const template = await prisma.template.findUnique({
      where: { id: templateId },
    });
    
    if (!template) {
      return handleNotFound("Template");
    }
    
    if (!canAccessTemplate(session, template)) {
      return handleForbidden("Cannot access this template");
    }

    logger.info("Template retrieved", {
      templateId,
      userId: session.userId,
    });

    return NextResponse.json({ template });
  } catch (error) {
    return handleApiError(error, "Failed to retrieve template");
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getEditorSession();
    if (session.error) return session.error;

    const resolvedParams = await params;
    const templateId = String(resolvedParams?.id || "").trim();
    
    if (!templateId) {
      return handleBadRequest("Missing template id");
    }

    const template = await prisma.template.findUnique({
      where: { id: templateId },
      select: {
        id: true,
        ownerId: true,
        name: true,
      },
    });
    
    if (!template) {
      return handleNotFound("Template");
    }
    
    if (!canAccessTemplate(session, template)) {
      return handleForbidden("Cannot delete this template");
    }

    await prisma.template.delete({ where: { id: templateId } });

    logger.info("Template deleted", {
      templateId,
      templateName: template.name,
      userId: session.userId,
    });

    return NextResponse.json({
      deleted: true,
      templateId,
      name: template.name,
    });
  } catch (error) {
    return handleApiError(error, "Failed to delete template");
  }
}
