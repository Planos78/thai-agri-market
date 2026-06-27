import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/rbac";
import { parseWindow } from "@/lib/report-params";
import { aggregateRefunds, type RefundRow } from "@/lib/reports";

// P7 refunds report: SUCCEEDED refunds settled in window, split CUSTOMER (money out) vs PLANT
// (clawback into the platform). Not orchard-scoped (refunds are order/buyer-grain).
export async function GET(req: Request) {
  const claims = await requirePerm(req, "reports.read");
  if (claims instanceof NextResponse) return claims;
  const win = parseWindow(req);
  if (win instanceof NextResponse) return win;

  const refunds = await prisma.refund.findMany({
    where: { status: "SUCCEEDED", settledAt: { gte: win.from, lt: win.to } },
    select: {
      refundNo: true,
      amount: true,
      kind: true,
      payoutType: true,
      settledAt: true,
      order: { select: { orderNo: true } },
    },
    orderBy: { settledAt: "desc" },
  });

  const rows: RefundRow[] = refunds.map((r) => ({
    refundNo: r.refundNo,
    orderNo: r.order.orderNo,
    amount: Number(r.amount),
    kind: r.kind,
    payoutType: r.payoutType,
    settledAt: r.settledAt,
  }));

  const report = aggregateRefunds(rows);
  return NextResponse.json({ from: win.from, to: win.to, ...report });
}
