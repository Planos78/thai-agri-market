import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/rbac";
import { requireOrderScope, orderBuyerLineUserId } from "@/lib/fulfillment-scope";
import { canTransitionOrder } from "@/lib/fulfillment";
import { relayPush } from "@/lib/line";

// #13 Mark delivered. Requires >=1 proof image; Delivery.DELIVERED + Order PREPARING->DELIVERED (tx).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const claims = await requirePerm(req, "delivery.write");
  if (claims instanceof NextResponse) return claims;
  const { id } = await params;
  const scopeErr = await requireOrderScope(claims, id);
  if (scopeErr) return scopeErr;

  const result = await prisma.$transaction(async (tx) => {
    const delivery = await tx.delivery.findUnique({
      where: { orderId: id },
      include: { _count: { select: { images: true } } },
    });
    if (!delivery) return { error: "delivery not found", status: 404 } as const;
    if (delivery._count.images < 1) return { error: "at least one proof image required", status: 409 } as const;

    const order = await tx.order.findUnique({ where: { id } });
    if (!order) return { error: "order not found", status: 404 } as const;
    if (!canTransitionOrder(order.status, "DELIVERED")) {
      return { error: `order not in PREPARING (${order.status})`, status: 409 } as const;
    }

    const d = await tx.delivery.update({
      where: { id: delivery.id },
      data: { status: "DELIVERED", deliveredAt: new Date() },
    });
    const o = await tx.order.update({ where: { id }, data: { status: "DELIVERED" } });
    return { order: o, delivery: d };
  });

  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });

  const buyerLine = await orderBuyerLineUserId(id);
  if (buyerLine) await relayPush("order-delivered", buyerLine, `ออเดอร์ ${id} จัดส่งสำเร็จแล้ว ขอบคุณค่ะ`);
  return NextResponse.json(result);
}
