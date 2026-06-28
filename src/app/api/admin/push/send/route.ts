import { NextRequest, NextResponse } from "next/server";

import { pushConfigured } from "@/lib/push/firebaseAdmin.server";
import {
  buildFcmMessage,
  isValidTopic,
  normalizeMessageType,
  sendToTokens,
  sendToTopic,
} from "@/lib/push/sendPush.server";
import {
  deactivateTokens,
  getActiveTokensForUserIds,
  getAllActiveTokens,
} from "@/lib/push/deviceTokens.server";
import { recordCampaign } from "@/lib/push/pushCampaigns.server";
import { handleApiError, handleBadRequest } from "@/lib/api/errors";
import { logger } from "@/lib/logging/logger";

import { requirePushAdmin } from "../_shared";

export const runtime = "nodejs";

function str(value: unknown) {
  return String(value ?? "").trim();
}

export async function POST(request: NextRequest) {
  const auth = await requirePushAdmin(request, "send", { limit: 30 });
  if ("error" in auth) return auth.error;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return handleBadRequest("Invalid JSON body");
  }

  const audience = body.audience || {};
  const audienceType = str(audience.type);
  if (!["all", "users", "topic"].includes(audienceType)) {
    return handleBadRequest("audience.type must be one of: all, users, topic.");
  }

  // Optional platform filter for token-based audiences (all / users). Empty or
  // both platforms targets everyone. Topic delivery is platform-agnostic.
  const rawPlatforms = (audience as { platforms?: unknown }).platforms;
  const platforms = Array.isArray(rawPlatforms)
    ? rawPlatforms.map((p) => str(p).toLowerCase()).filter((p) => p === "android" || p === "ios")
    : [];
  if (audienceType !== "topic" && Array.isArray(rawPlatforms) && platforms.length === 0) {
    return handleBadRequest("Select at least one platform (Android or iOS).");
  }
  const effectivePlatforms = platforms.length ? platforms : ["android", "ios"];

  // Build and validate the message payload.
  const messageType = normalizeMessageType(body.message?.messageType);
  const message = buildFcmMessage(body.message || {});
  if (!message.notification && !message.data) {
    return handleBadRequest(
      "Provide a title/body (notification) or at least one data field to send.",
    );
  }

  if (!(await pushConfigured())) {
    return NextResponse.json(
      { error: "Firebase push is not configured. Add a service account in Configuration first." },
      { status: 409 },
    );
  }

  const title = str(body.message?.notification?.title) || "(data message)";
  const messageBody = str(body.message?.notification?.body);

  try {
    type PlatformCounts = { sent: number; failed: number; total: number };
    let result: {
      successCount: number;
      failureCount: number;
      invalidTokens: string[];
      targetCount: number;
      messageId?: string;
      failures: Array<{ code: string; message: string; count: number }>;
      byPlatform: { android: PlatformCounts; ios: PlatformCounts } | null;
    };
    let audienceRef: Record<string, unknown> = {};

    if (audienceType === "topic") {
      const topic = str(audience.topic);
      if (!isValidTopic(topic)) {
        return handleBadRequest("Enter a valid topic name (letters, numbers, -_.~%).");
      }
      audienceRef = { topic };
      result = await sendToTopic(topic, message);
    } else {
      let entries: Array<{ token: string; platform: string }>;
      if (audienceType === "all") {
        audienceRef = { platforms: effectivePlatforms };
        entries = await getAllActiveTokens(platforms);
      } else {
        const userIds = Array.isArray(audience.userIds)
          ? audience.userIds.map(str).filter(Boolean)
          : [];
        if (!userIds.length) {
          return handleBadRequest("Select at least one recipient.");
        }
        audienceRef = { userIds, platforms: effectivePlatforms };
        entries = await getActiveTokensForUserIds(userIds, platforms);
      }

      if (!entries.length) {
        const campaign = await recordCampaign({
          title,
          body: messageBody,
          audienceType,
          audienceRef,
          messageType,
          payload: message,
          targetCount: 0,
          successCount: 0,
          failureCount: 0,
          status: "skipped",
          sentByUserId: auth.session.userId,
        });
        return NextResponse.json({
          successCount: 0,
          failureCount: 0,
          targetCount: 0,
          note: "No registered devices match this audience yet.",
          campaignId: campaign?.id || null,
        });
      }

      result = await sendToTokens(entries, message);
      // Prune tokens FCM reported as unregistered/invalid so future sends skip them.
      if (result.invalidTokens.length) {
        await deactivateTokens(result.invalidTokens);
      }
    }

    const status = result.successCount > 0 ? "sent" : result.failureCount > 0 ? "failed" : "sent";
    const failures = result.failures || [];
    const errorSummary =
      failures.map((f) => `${f.code} (x${f.count}): ${f.message}`).join(" | ").slice(0, 1000) ||
      null;
    const campaign = await recordCampaign({
      title,
      body: messageBody,
      audienceType,
      audienceRef,
      messageType,
      payload: message,
      targetCount: result.targetCount,
      successCount: result.successCount,
      failureCount: result.failureCount,
      status,
      error: errorSummary,
      sentByUserId: auth.session.userId,
    });

    logger.info("Push campaign sent", {
      userId: auth.session.userId,
      audienceType,
      targetCount: result.targetCount,
      successCount: result.successCount,
      failureCount: result.failureCount,
    });

    return NextResponse.json({
      successCount: result.successCount,
      failureCount: result.failureCount,
      targetCount: result.targetCount,
      prunedTokens: "invalidTokens" in result ? result.invalidTokens.length : 0,
      failures,
      byPlatform: result.byPlatform || null,
      campaignId: campaign?.id || null,
    });
  } catch (error) {
    return handleApiError(error, "Failed to send push notification.");
  }
}
