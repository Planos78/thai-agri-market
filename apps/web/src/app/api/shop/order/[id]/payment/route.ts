import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getPsp } from "@/lib/psp";
import { isOrderExpired } from "@/lib/orders";
import { shopSessionFromRequest } from "@/lib/auth";

// #16 Init payment for a SHOP order. Owner-gated by shop session phone. Reuses mock PSP +
// the existing payment callback (keys on orderNo, source-agnostic). Lazy expiry -> 410.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await shopSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "shop session required" }, { status: 403 });
  const { id } = await params;

  const order = await prisma.order.findUnique({ where: { id }, include: { buyer: { select: { phone: true } } } });
  if (!order) return NextResponse.json({ error: "order not found" }, { status: 404 });
  if (order.buyer.phone !== session.phone) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  if (isOrderExpired(order)) {
    await prisma.order.update({ where: { id }, data: { status: "EXPIRED" } });
    return NextResponse.json({ error: "order expired" }, { status: 410 });
  }
  if (order.status !== "WAITING_PAYMENT") {
    return NextResponse.json({ error: `order not payable (${order.status})` }, { status: 409 });
  }

  const amount = Number(order.totalAmount);
  const init = await getPsp().initPayment({ orderNo: order.orderNo, amount });
  return NextResponse.json({ ...init, amount });
}
