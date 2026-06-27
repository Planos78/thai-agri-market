import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePerm, scopedOrchardIds, inScope } from "@/lib/rbac";
import { parseWindow } from "@/lib/report-params";
import { computeReconciliation, type ReconRow } from "@/lib/reconciliation";

// P7 reconciliation workbook (Flow 8). READ-ONLY — surfaces variance, never corrects money.
// Identity: paymentsIn - payoutsOut - refundsOut - platformFee - heldEscrow == 0 on a balanced
// ledger. PLANT clawback refunds are EXCLUDED (they recover money INTO the platform; they cut a
// future payoutsOut, so subtracting them here would double-count). Rows with rowVariance != 0
// are the unexplained ones the console highlights.
export async function GET(req: Request) {
  const claims = await requirePerm(req, "reconciliation.read");
  if (claims instanceof NextResponse) return claims;
  const win = parseWindow(req);
  if (win instanceof NextResponse) return win;
  const scope = await scopedOrchardIds(claims);

  // Paid orders in the window define the universe (cash collected this period).
  const orders = await prisma.order.findMany({
    where: { paidAt: { gte: win.from, lt: win.to }, status: { not: "EXPIRED" } },
    select: {
      id: true,
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
      items: { select: { lot: { select: { orchardId: true } } } },
    },
  });

  const rows: ReconRow[] = [];
  for (const o of orders) {
    const oid = o.items[0]?.lot.orchardId;
    if (!oid) continue;
    if (win.orchardId && oid !== win.orchardId) continue;
    if (!inScope(scope, oid)) continue;
    rows.push({
      orderNo: o.orderNo,
      paidAt: o.paidAt,
      totalAmount: Number(o.totalAmount),
      feeVat: Number(o.feeAmount) + Number(o.vatFeeAmount),
      paidOut: o.payoutBatchOrders.reduce((s, p) => s + Number(p.amount), 0),
      refunded: o.refunds.reduce((s, r) => s + Number(r.amount), 0),
      heldEscrow: o.payment?.escrowStatus === "HELD",
    });
  }

  const result = computeReconciliation(rows);
  return NextResponse.json({ from: win.from, to: win.to, ...result });
}
