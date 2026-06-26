import { NextResponse } from "next/server";
import { requirePerm } from "@/lib/rbac";
import { requireOrderScope, orderBuyerLineUserId } from "@/lib/fulfillment-scope";
import { decideReschedule, isDecideError, type Decision } from "@/lib/fulfillment-tx";
import { relayPush } from "@/lib/line";

// #4 Operator decides a BUYER-proposed reschedule. REJECT may flag unfulfillable -> CANCELLED + refund.
export async function POST(req: Request, { params }: { params: Promise<{ id: string; rid: string }> }) {
  const claims = await requirePerm(req, "fulfillment.reschedule");
  if (claims instanceof NextResponse) return claims;
  const { id, rid } = await params;
  const scopeErr = await requireOrderScope(claims, id);
  if (scopeErr) return scopeErr;

  const { decision, unfulfillable } = (await req.json()) as { decision?: Decision; unfulfillable?: boolean };
  if (decision !== "APPROVE" && decision !== "REJECT") {
    return NextResponse.json({ error: "decision must be APPROVE or REJECT" }, { status: 422 });
  }

  const result = await decideReschedule({
    orderId: id,
    rescheduleId: rid,
    decision,
    decidedBy: claims.sub,
    unfulfillable: Boolean(unfulfillable),
  });
  if (isDecideError(result)) return NextResponse.json({ error: result.error }, { status: result.status });

  const buyerLine = await orderBuyerLineUserId(id);
  if (buyerLine) {
    await relayPush("reschedule-decided", buyerLine, `คำขอเลื่อนวันส่งออเดอร์ ${id} ถูก${decision === "APPROVE" ? "อนุมัติ" : "ปฏิเสธ"}`);
  }
  return NextResponse.json(result);
}
