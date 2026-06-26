import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getPsp } from "@/lib/psp";
import { isIncreasePaymentExpired, canPayIncrease, INCREASE_PAY_PREFIX } from "@/lib/fulfillment";
import { resolveBuyerOrder } from "@/lib/fulfillment-scope";

// #9 Buyer pays the pay-more on an approved INCREASE. Lazy-expire check then mock PSP init.
export async function POST(req: Request, { params }: { params: Promise<{ ipid: string }> }) {
  const { ipid } = await params;
  const { lineUserId } = (await req.json().catch(() => ({}))) as { lineUserId?: string };

  const ip = await prisma.increasePayment.findUnique({
    where: { id: ipid },
    include: { order: { select: { id: true, orderNo: true } } },
  });
  if (!ip) return NextResponse.json({ error: "increase-payment not found" }, { status: 404 });

  // Buyer must own the parent order.
  const owner = await resolveBuyerOrder(ip.orderId, lineUserId);
  if (owner instanceof NextResponse) return owner;

  // Lazy expiry (mirrors order pay): flip PENDING->EXPIRED and 410.
  if (isIncreasePaymentExpired(ip)) {
    await prisma.increasePayment.update({ where: { id: ip.id }, data: { status: "EXPIRED" } });
    return NextResponse.json({ error: "increase-payment expired" }, { status: 410 });
  }
  if (!canPayIncrease(ip.status)) {
    return NextResponse.json({ error: `not payable (${ip.status})` }, { status: 409 });
  }

  // Stable IP- invoice (reserved at approve; re-confirm to disambiguate in the shared callback).
  const invoiceNo = ip.pspRef ?? `${INCREASE_PAY_PREFIX}${ip.order.orderNo}`;
  const amount = Number(ip.amount);
  const init = await getPsp().initPayment({ orderNo: invoiceNo, amount });
  await prisma.increasePayment.update({ where: { id: ip.id }, data: { pspRef: init.invoiceNo } });

  return NextResponse.json({ paymentUrl: init.paymentUrl, invoiceNo: init.invoiceNo, amount });
}
