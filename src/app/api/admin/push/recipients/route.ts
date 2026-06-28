import { NextRequest, NextResponse } from "next/server";

import prisma from "@/lib/prisma";
import { handleApiError } from "@/lib/api/errors";

import { requirePushAdmin } from "../_shared";

export const runtime = "nodejs";

// Search mobile users for the "specific users" audience picker. Returns each
// user's active device count so the composer can warn about reachability.
export async function GET(request: NextRequest) {
  const auth = await requirePushAdmin(request, "recipients:read", { limit: 120 });
  if ("error" in auth) return auth.error;

  try {
    const query = String(request.nextUrl.searchParams.get("query") || "").trim();
    const where = query
      ? {
          OR: [
            { email: { contains: query, mode: "insensitive" as const } },
            { name: { contains: query, mode: "insensitive" as const } },
          ],
        }
      : {};

    const users = await prisma.mobileUser.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, name: true, email: true },
    });

    const ids = users.map((u) => u.id);
    const counts = ids.length
      ? await prisma.mobileDeviceToken.groupBy({
          by: ["mobileUserId"],
          where: { mobileUserId: { in: ids }, disabledAt: null },
          _count: { _all: true },
        })
      : [];
    const countByUser = new Map(counts.map((c) => [c.mobileUserId, c._count._all]));

    return NextResponse.json({
      recipients: users.map((u) => ({
        id: u.id,
        name: u.name || null,
        email: u.email || null,
        deviceCount: countByUser.get(u.id) || 0,
      })),
    });
  } catch (error) {
    return handleApiError(error, "Failed to search recipients.");
  }
}
