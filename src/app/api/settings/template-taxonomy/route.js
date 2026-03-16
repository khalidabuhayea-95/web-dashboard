import { NextResponse } from "next/server";

import { getEditorSession } from "@/lib/templates/server";
import {
  getTemplateTaxonomySettings,
  saveTemplateTaxonomySettings,
} from "@/lib/templates/templateSettings.server";

export async function GET() {
  const session = await getEditorSession();
  if (session.error) return session.error;

  const settings = await getTemplateTaxonomySettings();
  return NextResponse.json({
    settings,
    canEdit: session.role === "admin",
  });
}

export async function PUT(request) {
  const session = await getEditorSession();
  if (session.error) return session.error;
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const settings = await saveTemplateTaxonomySettings(body?.settings);
    return NextResponse.json({ settings, canEdit: true });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Failed to save taxonomy settings." },
      { status: 500 }
    );
  }
}
