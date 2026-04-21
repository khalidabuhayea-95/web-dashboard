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
import {
  appendVersionParam,
  deleteObjects,
  getPublicStorageBucketName,
  parsePublicObjectKey,
  rewritePublicObjectUrlsForClient,
} from "@/lib/storage/objectStorage.server";

function collectPublicObjectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (typeof value === "string") {
    const key = parsePublicObjectKey(value);
    if (key) keys.add(key);
    return keys;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectPublicObjectKeys(item, keys));
    return keys;
  }

  if (value && typeof value === "object") {
    Object.values(value as Record<string, unknown>).forEach((item) =>
      collectPublicObjectKeys(item, keys)
    );
  }

  return keys;
}

async function isObjectKeyReferencedOutsideTemplate(key: string, templateId: string) {
  const coreRows = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS count
    FROM (
      SELECT 1
      FROM "Template"
      WHERE id <> ${templateId}::uuid
        AND (
          POSITION(${key} IN COALESCE("thumbnailDataUrl", '')) > 0
          OR POSITION(${key} IN COALESCE("previewVideoUrl", '')) > 0
          OR POSITION(${key} IN COALESCE("previewPosterUrl", '')) > 0
          OR POSITION(${key} IN data::text) > 0
        )
      UNION ALL
      SELECT 1
      FROM "TemplateRevision"
      WHERE "templateId" <> ${templateId}::uuid
        AND POSITION(${key} IN snapshot::text) > 0
      UNION ALL
      SELECT 1
      FROM "FontFile"
      WHERE POSITION(${key} IN COALESCE("publicUrl", '')) > 0
        OR COALESCE("storagePath", '') = ${key}
      UNION ALL
      SELECT 1
      FROM "AppSetting"
      WHERE POSITION(${key} IN value::text) > 0
    ) refs
  `;

  if (Number(coreRows?.[0]?.count || 0) > 0) return true;

  for (const tableName of ["editor_element_assets", "editor_background_assets"]) {
    const tableRows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `
        SELECT COUNT(*)::bigint AS count
        FROM ${tableName}
        WHERE POSITION($1 IN COALESCE(asset_url, '')) > 0
          OR POSITION($1 IN COALESCE(thumbnail_url, '')) > 0
          OR POSITION($1 IN source_payload::text) > 0
      `,
      key
    ).catch((error) => {
      if (String(error?.message || "").includes("does not exist")) {
        return [{ count: 0n }];
      }
      throw error;
    });

    if (Number(tableRows?.[0]?.count || 0) > 0) return true;
  }

  return false;
}

async function findDeletableTemplateMediaKeys(template: any) {
  const keys = collectPublicObjectKeys({
    thumbnailDataUrl: template.thumbnailDataUrl,
    previewVideoUrl: template.previewVideoUrl,
    previewPosterUrl: template.previewPosterUrl,
    data: template.data,
    revisions: template.revisions?.map((revision: any) => revision.snapshot) || [],
  });

  const deletable: string[] = [];
  const retained: string[] = [];

  for (const key of keys) {
    if (await isObjectKeyReferencedOutsideTemplate(key, template.id)) {
      retained.push(key);
    } else {
      deletable.push(key);
    }
  }

  return { deletable, retained };
}

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

    const updatedAt =
      template?.updatedAt instanceof Date
        ? template.updatedAt.getTime()
        : template?.updatedAt
          ? new Date(template.updatedAt).getTime()
          : NaN;

    return NextResponse.json(
      rewritePublicObjectUrlsForClient({
        template: {
          ...template,
          thumbnailDataUrl: appendVersionParam(
            template?.thumbnailDataUrl,
            Number.isFinite(updatedAt) ? String(updatedAt) : String(template?.version || "")
          ),
        },
      })
    );
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
      include: {
        revisions: {
          select: {
            snapshot: true,
          },
        },
      },
    });
    
    if (!template) {
      return handleNotFound("Template");
    }
    
    if (!canAccessTemplate(session, template)) {
      return handleForbidden("Cannot delete this template");
    }

    const mediaCleanup = await findDeletableTemplateMediaKeys(template);

    await prisma.template.delete({ where: { id: templateId } });

    const mediaBucket = getPublicStorageBucketName();
    let deletedMediaCount = 0;
    let mediaDeleteError = "";
    if (mediaCleanup.deletable.length > 0) {
      try {
        await deleteObjects(mediaBucket, mediaCleanup.deletable);
        deletedMediaCount = mediaCleanup.deletable.length;
      } catch (error) {
        mediaDeleteError = error instanceof Error ? error.message : String(error || "");
        logger.warn("Failed to delete template media objects", {
          templateId,
          mediaBucket,
          mediaCount: mediaCleanup.deletable.length,
          error: mediaDeleteError,
        });
      }
    }

    logger.info("Template deleted", {
      templateId,
      templateName: template.name,
      userId: session.userId,
      deletedMediaCount,
      retainedSharedMediaCount: mediaCleanup.retained.length,
    });

    return NextResponse.json({
      deleted: true,
      templateId,
      name: template.name,
      media: {
        deleted: deletedMediaCount,
        retainedShared: mediaCleanup.retained.length,
        failed: mediaDeleteError ? mediaCleanup.deletable.length : 0,
        error: mediaDeleteError || null,
      },
    });
  } catch (error) {
    return handleApiError(error, "Failed to delete template");
  }
}
