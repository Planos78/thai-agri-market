import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// Order history for the calling verified LINE user only (no IDOR): the lineUserId is
// verified, mapped to its own buyer User, and orders are filtered by that buyerId.
export async function GET(req: Request) {
  const lineUserId = new URL(req.url).searchParams.get("lineUserId");
  if (!lineUserId) {
    return NextResponse.json({ error: "lineUserId required" }, { status: 400 });
  }

  const verified = await prisma.verifiedLineUser.findUnique({ where: { lineUserId } });
  if (!verified) {
    return NextResponse.json({ error: "line user not verified" }, { status: 403 });
  }

  const buyer = await prisma.user.findUnique({ where: { lineUserId } });
  if (!buyer) return NextResponse.json({ orders: [] });

  const orders = await prisma.order.findMany({
    where: { buyerId: buyer.id },
    orderBy: { createdAt: "desc" },
    select: {
      orderNo: true,
      status: true,
      totalAmount: true,
      createdAt: true,
      items: { select: { quantity: true, price: true, lot: { select: { fruitName: true } } } },
    },
  });

  return NextResponse.json({
    orders: orders.map((o) => ({
      orderNo: o.orderNo,
      status: o.status,
      totalAmount: o.totalAmount.toString(),
      createdAt: o.createdAt.toISOString(),
      items: o.items.map((i) => ({
        fruitName: i.lot.fruitName,
        quantity: i.quantity,
        price: i.price.toString(),
      })),
    })),
  });
}
