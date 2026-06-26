import { NextResponse } from "next/server";
import { resolveBuyerOrder, pushToOrchard } from "@/lib/fulfillment-scope";
import { decideReschedule, isDecideError, type Decision } from "@/lib/fulfillment-tx";

// #3 Buyer decides an ORCHARD-proposed reschedule. REJECT may flag unfulfillable -> CANCELLED + refund.
export async function POST(req: Request, { params }: { params: Promise<{ id: string; rid: string }> }) {
  const { id, rid } = await params;
  const { lineUserId, decision, unfulfillable } = (await req.json()) as {
    lineUserId?: string;
    decision?: Decision;
    unfulfillable?: boolean;
  };

  const owner = await resolveBuyerOrder(id, lineUserId);
  if (owner instanceof NextResponse) return owner;
  if (decision !== "APPROVE" && decision !== "REJECT") {
    return NextResponse.json({ error: "decision must be APPROVE or REJECT" }, { status: 422 });
  }

  const result = await decideReschedule({
    orderId: id,
    rescheduleId: rid,
    decision,
    decidedBy: owner.lineUserId,
    unfulfillable: Boolean(unfulfillable),
  });
  if (isDecideError(result)) return NextResponse.json({ error: result.error }, { status: result.status });

  await pushToOrchard(id, "reschedule-decided", `ลูกค้า ${decision === "APPROVE" ? "ยืนยัน" : "ปฏิเสธ"}การเลื่อนวันส่งออเดอร์ ${id}`);
  return NextResponse.json(result);
}
