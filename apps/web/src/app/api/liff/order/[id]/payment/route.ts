import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getPsp } from "@/lib/psp";
import { isOrderExpired } from "@/lib/orders";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) return NextResponse.json({ error: "order not found" }, { status: 404 });

  // Lazy expiry check (AC3); the P7 cron sweep does this in bulk.
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
