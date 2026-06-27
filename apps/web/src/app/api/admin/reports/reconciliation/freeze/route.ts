import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/rbac";
import { parseWindow } from "@/lib/report-params";
import { computeReconciliation, type ReconRow } from "@/lib/reconciliation";

// P7 reconcile freeze: persist a ReconciliationSnapshot for audit history. Writes ONLY the
// snapshot table — never Refund/Payout/Payment. Human-only (reconciliation.write). Duplicate
// period -> 409. `period` derived from the window (the `from` day).
export async function POST(req: Request) {
  const claims = await requirePerm(req, "reconciliation.write");
  if (claims instanceof NextResponse) return claims;
  const win = parseWindow(req);
  if (win instanceof NextResponse) return win;

  const orders = await prisma.order.findMany({
    where: { paidAt: { gte: win.from, lt: win.to }, status: { not: "EXPIRED" } },
    select: {
      orderNo: true,
      paidAt: true,
      totalAmount: true,
      feeAmount: true,
      vatFeeAmount: true,
      payment: { select: { escrowStatus: true } },
      payoutBatchOrders: {
        where: { batch: { status: "SUCCEEDED", settledAt: { gte: win.from, lt: win.to } } },
        select: { amount: true },
      },
      refunds: {
        where: { status: "SUCCEEDED", payoutType: "CUSTOMER", settledAt: { gte: win.from, lt: win.to } },
        select: { amount: true },
      },
    },
  });

  const rows: ReconRow[] = orders.map((o) => ({
    orderNo: o.orderNo,
    paidAt: o.paidAt,
    totalAmount: Number(o.totalAmount),
    feeVat: Number(o.feeAmount) + Number(o.vatFeeAmount),
    paidOut: o.payoutBatchOrders.reduce((s, p) => s + Number(p.amount), 0),
    refunded: o.refunds.reduce((s, r) => s + Number(r.amount), 0),
    heldEscrow: o.payment?.escrowStatus === "HELD",
  }));
  const { totals } = computeReconciliation(rows);
  const period = win.from.toISOString().slice(0, 10);

  try {
    const snapshot = await prisma.reconciliationSnapshot.create({
      data: {
        period,
        paymentsIn: totals.paymentsIn,
        payoutsOut: totals.payoutsOut,
        refundsOut: totals.refundsOut,
        platformFee: totals.platformFee,
        heldEscrow: totals.heldEscrow,
        variance: totals.variance,
        createdBy: claims.sub,
      },
    });
    return NextResponse.json({ snapshot }, { status: 200 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json({ error: "snapshot for this period already exists" }, { status: 409 });
    }
    throw err;
  }
}
