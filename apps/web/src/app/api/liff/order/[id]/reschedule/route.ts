import { NextResponse } from "next/server";
import { resolveBuyerOrder, pushToOrchard } from "@/lib/fulfillment-scope";
import { proposeReschedule } from "@/lib/fulfillment-tx";

// #2 Buyer proposes a new delivery date. Supersedes any prior PENDING (one tx).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { lineUserId, proposedDate, note } = (await req.json()) as {
    lineUserId?: string;
    proposedDate?: string;
    note?: string;
  };

  const owner = await resolveBuyerOrder(id, lineUserId);
  if (owner instanceof NextResponse) return owner;

  const date = proposedDate ? new Date(proposedDate) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return NextResponse.json({ error: "valid proposedDate required" }, { status: 422 });
  }

  const reschedule = await proposeReschedule({ orderId: id, proposedDate: date, proposedBy: "BUYER", note });
  await pushToOrchard(id, "reschedule-proposed", `ลูกค้าขอเลื่อนวันส่งออเดอร์ ${id} เป็น ${date.toISOString().slice(0, 10)}`);
  return NextResponse.json({ reschedule }, { status: 201 });
}
