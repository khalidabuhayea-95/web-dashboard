import { NextResponse } from "next/server";

import prisma from "@/lib/prisma";
import { canAccessTemplate, getEditorSession } from "@/lib/templates/server";

export async function GET(_request, { params }) {
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

  return NextResponse.json({ template });
}

export async function DELETE(_request, { params }) {
  const session = await getEditorSession();
  if (session.error) return session.error;

  const resolvedParams = await params;
  const templateId = String(resolvedParams?.id || "").trim();
  if (!templateId) {
    return NextResponse.json({ error: "Missing template id." }, { status: 400 });
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
    return NextResponse.json({ error: "Template not found." }, { status: 404 });
  }
  if (!canAccessTemplate(session, template)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await prisma.template.delete({ where: { id: templateId } });
  return NextResponse.json({
    deleted: true,
    templateId,
    name: template.name,
  });
}
