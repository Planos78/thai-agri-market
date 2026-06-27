import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePerm, scopedOrchardIds, inScope } from "@/lib/rbac";
import { parseWindow } from "@/lib/report-params";
import { aggregateRevenue, type RevenueRow } from "@/lib/reports";

// P7 revenue report: paid orders in window (paidAt in [from,to], not CANCELLED/EXPIRED).
// Grouped by orchard via OrderItem.lot.orchardId. Orchard-scoped admins see only in-scope.
export async function GET(req: Request) {
  const claims = await requirePerm(req, "reports.read");
  if (claims instanceof NextResponse) return claims;
  const win = parseWindow(req);
  if (win instanceof NextResponse) return win;
  const scope = await scopedOrchardIds(claims);

  const orders = await prisma.order.findMany({
    where: {
      paidAt: { gte: win.from, lt: win.to },
      status: { notIn: ["CANCELLED", "EXPIRED"] },
    },
    select: {
      subTotal: true,
      feeAmount: true,
      vatFeeAmount: true,
      items: { select: { lot: { select: { orchardId: true, orchard: { select: { name: true } } } } } },
    },
  });

  // Each order is attributed to the orchard of its first item (orders are single-orchard in
  // this marketplace). Filter by orchardId param and by scope.
  const rows: RevenueRow[] = [];
  for (const o of orders) {
    const first = o.items[0]?.lot;
    if (!first) continue;
    if (win.orchardId && first.orchardId !== win.orchardId) continue;
    if (!inScope(scope, first.orchardId)) continue;
    rows.push({
      orchardId: first.orchardId,
      orchardName: first.orchard.name,
      subTotal: Number(o.subTotal),
      feeAmount: Number(o.feeAmount),
      vatFeeAmount: Number(o.vatFeeAmount),
    });
  }

  const report = aggregateRevenue(rows);
  return NextResponse.json({ from: win.from, to: win.to, ...report });
}
