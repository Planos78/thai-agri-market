import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePerm, scopedOrchardIds, inScope } from "@/lib/rbac";
import { parseWindow } from "@/lib/report-params";
import { round2 } from "@/lib/money";

// P7 expense/payout report: amounts actually paid out to orchards. Source = PayoutBatchOrder
// whose batch SUCCEEDED + settledAt in window. Grouped by orchard (via payoutAccount.orchardId).
export async function GET(req: Request) {
  const claims = await requirePerm(req, "reports.read");
  if (claims instanceof NextResponse) return claims;
  const win = parseWindow(req);
  if (win instanceof NextResponse) return win;
  const scope = await scopedOrchardIds(claims);

  const lines = await prisma.payoutBatchOrder.findMany({
    where: { batch: { status: "SUCCEEDED", settledAt: { gte: win.from, lt: win.to } } },
    select: {
      amount: true,
      payoutAccount: { select: { orchardId: true, orchard: { select: { name: true } } } },
      batch: { select: { batchNo: true, settledAt: true } },
    },
  });

  const byOrchard = new Map<string, { name: string; total: number }>();
  const byBatch = new Map<string, { settledAt: Date | null; total: number }>();
  let totalPaidOut = 0;
  for (const l of lines) {
    const oid = l.payoutAccount.orchardId;
    if (win.orchardId && oid !== win.orchardId) continue;
    if (!inScope(scope, oid)) continue;
    const amt = Number(l.amount);
    totalPaidOut += amt;
    const o = byOrchard.get(oid) ?? { name: l.payoutAccount.orchard.name, total: 0 };
    o.total += amt;
    byOrchard.set(oid, o);
    const b = byBatch.get(l.batch.batchNo) ?? { settledAt: l.batch.settledAt, total: 0 };
    b.total += amt;
    byBatch.set(l.batch.batchNo, b);
  }

  return NextResponse.json({
    from: win.from,
    to: win.to,
    totalPaidOut: round2(totalPaidOut),
    byOrchard: [...byOrchard.entries()].map(([orchardId, v]) => ({ orchardId, name: v.name, total: round2(v.total) })),
    batches: [...byBatch.entries()].map(([batchNo, v]) => ({ batchNo, settledAt: v.settledAt, total: round2(v.total) })),
  });
}
