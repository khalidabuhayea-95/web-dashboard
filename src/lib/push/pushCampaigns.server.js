import prisma from "@/lib/prisma";
import { deleteStorageForUrls } from "@/lib/storage/assetReferences.server";

// Audit log of sent push campaigns (one row per send action).

export async function recordCampaign(data) {
  try {
    return await prisma.pushCampaign.create({ data });
  } catch {
    return null;
  }
}

export async function listCampaignsPage({ limit = 10, offset = 0 } = {}) {
  const take = Math.min(Math.max(Number(limit) || 10, 1), 50);
  const skip = Math.max(Number(offset) || 0, 0);
  try {
    const [items, total] = await Promise.all([
      prisma.pushCampaign.findMany({ orderBy: { createdAt: "desc" }, take, skip }),
      prisma.pushCampaign.count(),
    ]);
    return { items, total };
  } catch {
    return { items: [], total: 0 };
  }
}

export async function deleteCampaign(id) {
  const campaignId = String(id || "").trim();
  if (!campaignId) return false;
  try {
    // The notification image is an R2 upload (admin/push/upload-image) recorded only inside
    // the payload, so it has to be read out before the row goes.
    const existing = await prisma.pushCampaign.findUnique({
      where: { id: campaignId },
      select: { payload: true },
    });
    if (!existing) return false;
    await prisma.pushCampaign.delete({ where: { id: campaignId } });
    await deleteStorageForUrls([existing.payload?.notification?.image], { campaignId });
    return true;
  } catch {
    return false;
  }
}
