import { NextResponse } from "next/server";

import { getEditorSession } from "@/lib/templates/server";
import {
  getFreepikImportSettings,
  saveFreepikImportSettings,
} from "@/lib/tools/freepikImport.server";

function toPublicSettings(settings) {
  return {
    apiKeyConfigured: Boolean(settings?.apiKeyConfigured || settings?.apiKey),
    apiKeyMasked: String(settings?.apiKeyMasked || ""),
    defaults: settings?.defaults || {},
    updatedAt: String(settings?.updatedAt || ""),
  };
}

export async function GET() {
  const session = await getEditorSession();
  if (session.error) return session.error;

  const settings = await getFreepikImportSettings();
  return NextResponse.json({
    settings: toPublicSettings(settings),
    canEdit: session.role === "admin",
  });
}

export async function PUT(request) {
  const session = await getEditorSession();
  if (session.error) return session.error;
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  try {
    const saved = await saveFreepikImportSettings({
      apiKey: body?.apiKey,
      defaults: body?.defaults,
    });

    return NextResponse.json({
      settings: toPublicSettings(saved),
      canEdit: true,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Failed to save Freepik settings." },
      { status: 500 }
    );
  }
}
