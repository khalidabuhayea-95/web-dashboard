import { NextResponse } from "next/server";

import prisma from "@/lib/prisma";
import { canAccessTemplate, getEditorSession } from "@/lib/templates/server";

export async function GET(request, { params }) {
  const session = await getEditorSession();
  if (session.error) return session.error;

  const resolvedParams = await params;
  const templateId = resolvedParams?.id;
  if (!templateId) {
    return NextResponse.json({ error: "Missing template id." }, { status: 400 });
  }

  const template = await prisma.template.findUnique({ where: { id: templateId } });
  if (!template) {
    return NextResponse.json({ error: "Template not found." }, { status: 404 });
  }
  if (!canAccessTemplate(session, template)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const limit = Math.min(Math.max(Number(new URL(request.url).searchParams.get("limit") || 25), 1), 100);

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
}
