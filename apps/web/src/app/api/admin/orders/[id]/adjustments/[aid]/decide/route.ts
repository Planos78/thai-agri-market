import { NextResponse } from "next/server";
import { requirePerm } from "@/lib/rbac";
import { requireOrderScope, orderBuyerLineUserId } from "@/lib/fulfillment-scope";
import { decideAdjustment, isDecideError, type Decision } from "@/lib/fulfillment-tx";
import { relayPush } from "@/lib/line";

// #7 Operator decides an adjustment. APPROVE mutates qty + recomputes totals;
// REDUCE -> refund intent; INCREASE -> IncreasePayment(PENDING). All in one tx.
export async function POST(req: Request, { params }: { params: Promise<{ id: string; aid: string }> }) {
  const claims = await requirePerm(req, "fulfillment.adjust");
  if (claims instanceof NextResponse) return claims;
  const { id, aid } = await params;
  const scopeErr = await requireOrderScope(claims, id);
  if (scopeErr) return scopeErr;

  const { decision } = (await req.json()) as { decision?: Decision };
  if (decision !== "APPROVE" && decision !== "REJECT") {
    return NextResponse.json({ error: "decision must be APPROVE or REJECT" }, { status: 422 });
  }

  const result = await decideAdjustment({ orderId: id, adjustmentId: aid, decision, decidedBy: claims.sub });
  if (isDecideError(result)) return NextResponse.json({ error: result.error }, { status: result.status });

  const buyerLine = await orderBuyerLineUserId(id);
  if (buyerLine) {
    await relayPush("adjustment-decided", buyerLine, `การปรับจำนวนในออเดอร์ ${id} ถูก${decision === "APPROVE" ? "อนุมัติ" : "ปฏิเสธ"}`);
  }
  return NextResponse.json(result);
}
