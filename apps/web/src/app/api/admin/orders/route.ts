import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/rbac";

// RBAC-scoped orders console (read). Requires perm "orders.read" (AC6).
export async function GET(req: Request) {
  const claims = await requirePerm(req, "orders.read");
  if (claims instanceof NextResponse) return claims;
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
