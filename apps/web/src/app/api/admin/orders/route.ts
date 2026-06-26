import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyAdminJwt, bearer } from "@/lib/auth";

// RBAC-scoped orders console (read). Requires perm "orders.read" (AC6).
export async function GET(req: Request) {
  const claims = await verifyAdminJwt(bearer(req) ?? "");
  if (!claims) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!claims.perms.includes("orders.read")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const orders = await prisma.order.findMany({
    include: {
      items: true,
      payment: true,
      buyer: { select: { lineUserId: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ orders });
}
