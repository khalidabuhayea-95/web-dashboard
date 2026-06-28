import prisma from "@/lib/prisma";

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
    await prisma.pushCampaign.delete({ where: { id: campaignId } });
    return true;
  } catch {
    return false;
  }
}
