import { NextRequest, NextResponse } from "next/server";

import {
  getPushSettings,
  savePushSettings,
  toPublicPushSettings,
} from "@/lib/settings/pushSettings.server";
import { countActiveDevicesByPlatform } from "@/lib/push/deviceTokens.server";
import { handleApiError, handleBadRequest } from "@/lib/api/errors";
import { logger } from "@/lib/logging/logger";

import { requirePushAdmin } from "../_shared";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await requirePushAdmin(request, "config:read", { limit: 60 });
  if ("error" in auth) return auth.error;

  try {
    const [settings, deviceCounts] = await Promise.all([
      getPushSettings(),
      countActiveDevicesByPlatform(),
    ]);
    return NextResponse.json({
      config: toPublicPushSettings(settings),
      deviceCount: deviceCounts.total,
      deviceCounts,
      canEdit: true,
    });
  } catch (error) {
    return handleApiError(error, "Failed to load push configuration.");
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requirePushAdmin(request, "config:write", { limit: 20 });
  if ("error" in auth) return auth.error;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return handleBadRequest("Invalid JSON body");
  }

  try {
    const saved = await savePushSettings({
      serviceAccountJson: body.serviceAccountJson,
      defaultTopic: body.defaultTopic,
    });
    logger.info("Push FCM configuration updated", {
      userId: auth.session.userId,
      projectId: saved.serviceAccount.projectId,
    });
    return NextResponse.json({ config: toPublicPushSettings(saved) });
  } catch (error) {
    // parseServiceAccountJson throws user-facing validation messages.
    return handleBadRequest(error instanceof Error ? error.message : "Invalid service account.");
  }
}
