import { NextRequest, NextResponse } from "next/server";

import { deleteCampaign, listCampaignsPage } from "@/lib/push/pushCampaigns.server";
import { handleApiError, handleBadRequest } from "@/lib/api/errors";
import { logger } from "@/lib/logging/logger";

import { requirePushAdmin } from "../_shared";

export const runtime = "nodejs";

const DEFAULT_PAGE_SIZE = 10;

type Campaign = Awaited<ReturnType<typeof listCampaignsPage>>["items"][number];

function mapCampaign(c: Campaign) {
  return {
    id: c.id,
    title: c.title,
    body: c.body,
    audienceType: c.audienceType,
    audienceRef: c.audienceRef,
    messageType: c.messageType,
    payload: c.payload,
    targetCount: c.targetCount,
    successCount: c.successCount,
    failureCount: c.failureCount,
    status: c.status,
    error: c.error,
    createdAt: c.createdAt.toISOString(),
  };
}

export async function GET(request: NextRequest) {
  const auth = await requirePushAdmin(request, "campaigns:read", { limit: 60 });
  if ("error" in auth) return auth.error;

  try {
    const page = Math.max(1, Math.floor(Number(request.nextUrl.searchParams.get("page")) || 1));
    const pageSize = Math.min(
      Math.max(Math.floor(Number(request.nextUrl.searchParams.get("pageSize")) || DEFAULT_PAGE_SIZE), 1),
      50,
    );
    const { items, total } = await listCampaignsPage({
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    return NextResponse.json({
      campaigns: items.map(mapCampaign),
      total,
      page,
      pageSize,
    });
  } catch (error) {
    return handleApiError(error, "Failed to load push history.");
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requirePushAdmin(request, "campaigns:delete", { limit: 30 });
  if ("error" in auth) return auth.error;

  try {
    const id = String(request.nextUrl.searchParams.get("id") || "").trim();
    if (!id) return handleBadRequest("Campaign id is required.");
    const ok = await deleteCampaign(id);
    if (ok) logger.info("Push campaign deleted", { userId: auth.session.userId, campaignId: id });
    return NextResponse.json({ ok });
  } catch (error) {
    return handleApiError(error, "Failed to delete campaign.");
  }
}
