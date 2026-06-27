import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePerm, scopedOrchardIds, inScope } from "@/lib/rbac";
import { parseWindow } from "@/lib/report-params";
import { aggregateWht, type WhtRow } from "@/lib/reports";

// P7 WHT report: withholding tax = round2(feeAmount * WHT_RATE) over the same paid order set
// as Revenue. COMPUTED, not stored (response flags computed:true, unaudited). Real WHT certs
// are deferred.
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
      feeAmount: true,
      items: { select: { lot: { select: { orchardId: true, orchard: { select: { name: true } } } } } },
    },
  });

  const rows: WhtRow[] = [];
  for (const o of orders) {
    const first = o.items[0]?.lot;
    if (!first) continue;
    if (win.orchardId && first.orchardId !== win.orchardId) continue;
    if (!inScope(scope, first.orchardId)) continue;
    rows.push({ orchardId: first.orchardId, orchardName: first.orchard.name, feeAmount: Number(o.feeAmount) });
  }

  const report = aggregateWht(rows);
  return NextResponse.json({ from: win.from, to: win.to, ...report });
}
