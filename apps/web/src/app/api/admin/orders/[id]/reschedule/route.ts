import { NextResponse } from "next/server";
import { requirePerm } from "@/lib/rbac";
import { requireOrderScope, orderBuyerLineUserId } from "@/lib/fulfillment-scope";
import { proposeReschedule } from "@/lib/fulfillment-tx";
import { relayPush } from "@/lib/line";

// #1 Orchard (admin) proposes a new delivery date. Supersedes any prior PENDING (one tx).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const claims = await requirePerm(req, "fulfillment.reschedule");
  if (claims instanceof NextResponse) return claims;
  const { id } = await params;
  const scopeErr = await requireOrderScope(claims, id);
  if (scopeErr) return scopeErr;

  const { proposedDate, note } = (await req.json()) as { proposedDate?: string; note?: string };
  const date = proposedDate ? new Date(proposedDate) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return NextResponse.json({ error: "valid proposedDate required" }, { status: 422 });
  }

  const reschedule = await proposeReschedule({ orderId: id, proposedDate: date, proposedBy: "ORCHARD", note });

  const buyerLine = await orderBuyerLineUserId(id);
  if (buyerLine) {
    await relayPush("reschedule-proposed", buyerLine, `สวนขอเลื่อนวันส่งออเดอร์ ${id} เป็น ${date.toISOString().slice(0, 10)}`);
  }
  return NextResponse.json({ reschedule }, { status: 201 });
}
