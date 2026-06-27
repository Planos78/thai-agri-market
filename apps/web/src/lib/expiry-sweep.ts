import { prisma } from "@/lib/db";

// P7 expiry-sweep (deferred from P1). Flips WAITING_PAYMENT orders past paymentExpiredAt
// to EXPIRED (payment FAILED/REFUNDED) inside a $transaction. No lot release: order-create
// reserves no inventory. Idempotent: a 2nd run selects nothing (status no longer WAITING).

export interface SweepCandidate {
  id: string;
  status: string;
  paymentExpiredAt: Date | null;
}

// Pure selection (unit-tested): only WAITING_PAYMENT with a paymentExpiredAt strictly before
// `now`. Ignores PAID/EXPIRED/etc and orders with no/future expiry.
export function selectExpiredOrderIds(orders: SweepCandidate[], now: Date): string[] {
  return orders
    .filter((o) => o.status === "WAITING_PAYMENT" && o.paymentExpiredAt !== null && o.paymentExpiredAt < now)
    .map((o) => o.id);
}

export interface SweepResult {
  swept: number;
  ids: string[];
}

export async function runExpirySweep(now = new Date()): Promise<SweepResult> {
  const orders = await prisma.order.findMany({
    where: { status: "WAITING_PAYMENT", paymentExpiredAt: { lt: now } },
    select: { id: true, status: true, paymentExpiredAt: true },
  });
  const ids = selectExpiredOrderIds(orders, now);

  for (const id of ids) {
    await prisma.$transaction(async (tx) => {
      // Re-check inside the tx so a concurrent payment callback can't be overwritten.
      const fresh = await tx.order.findUnique({ where: { id }, select: { status: true } });
      if (!fresh || fresh.status !== "WAITING_PAYMENT") return;
      await tx.order.update({ where: { id }, data: { status: "EXPIRED" } });
      // Escrow on an unpaid order was HELD-as-intent only; no money moved -> no Refund row.
      await tx.payment.updateMany({
        where: { orderId: id, status: "PENDING" },
        data: { status: "FAILED", escrowStatus: "REFUNDED" },
      });
    });
  }
  return { swept: ids.length, ids };
}
