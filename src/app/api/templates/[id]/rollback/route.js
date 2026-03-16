import { NextResponse } from "next/server";

import prisma from "@/lib/prisma";
import { buildSnapshot, canAccessTemplate, getEditorSession } from "@/lib/templates/server";

export async function POST(request, { params }) {
  const session = await getEditorSession();
  if (session.error) return session.error;

  const resolvedParams = await params;
  const templateId = resolvedParams?.id;
  if (!templateId) {
    return NextResponse.json({ error: "Missing template id." }, { status: 400 });
  }

  const body = await request.json();
  const revisionId = typeof body?.revisionId === "string" ? body.revisionId : "";
  if (!revisionId) {
    return NextResponse.json({ error: "Missing revision id." }, { status: 400 });
  }

  const template = await prisma.template.findUnique({ where: { id: templateId } });
  if (!template) {
    return NextResponse.json({ error: "Template not found." }, { status: 404 });
  }
  if (!canAccessTemplate(session, template)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const revision = await prisma.templateRevision.findFirst({
    where: { id: revisionId, templateId },
    select: { snapshot: true },
  });

  if (!revision) {
    return NextResponse.json({ error: "Revision not found." }, { status: 404 });
  }

  const snapshot = revision.snapshot || {};

  const rolledBack = await prisma.$transaction(async (tx) => {
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
        publishedAt:
          snapshot.status === "published"
            ? new Date()
            : null,
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
}
