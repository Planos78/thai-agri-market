import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { shopSessionFromRequest } from "@/lib/auth";

// P6: order history for the calling shop buyer (mobile gap — LIFF history keys off lineUserId,
// null for shop buyers). Gated by the shop session; orders filtered to the session phone's buyer.
export async function GET(req: Request) {
  const session = await shopSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "shop session required" }, { status: 403 });

  const buyer = await prisma.user.findUnique({ where: { email: `${session.phone}@shop.local` } });
  if (!buyer) return NextResponse.json({ orders: [] });

  const orders = await prisma.order.findMany({
    where: { buyerId: buyer.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      orderNo: true,
      status: true,
      totalAmount: true,
      createdAt: true,
      items: { select: { quantity: true, price: true, lot: { select: { fruitName: true } } } },
    },
  });

  return NextResponse.json({
    orders: orders.map((o) => ({
      id: o.id,
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
