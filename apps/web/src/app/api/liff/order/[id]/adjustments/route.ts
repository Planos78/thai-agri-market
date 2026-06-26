import { NextResponse } from "next/server";
import { resolveBuyerOrder, pushToOrchard } from "@/lib/fulfillment-scope";
import { proposeAdjustment, isDecideError } from "@/lib/fulfillment-tx";

// #6 Buyer proposes an item-grain qty adjustment (REDUCE/INCREASE). Creates PENDING.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { lineUserId, orderItemId, kind, deltaQty, note } = (await req.json()) as {
    lineUserId?: string;
    orderItemId?: string;
    kind?: "REDUCE" | "INCREASE";
    deltaQty?: number;
    note?: string;
  };

  const owner = await resolveBuyerOrder(id, lineUserId);
  if (owner instanceof NextResponse) return owner;
  if (!orderItemId || !kind || deltaQty == null) {
    return NextResponse.json({ error: "orderItemId, kind, deltaQty required" }, { status: 422 });
  }

  const result = await proposeAdjustment({ orderId: id, orderItemId, kind, deltaQty, proposedBy: "BUYER", note });
  if (isDecideError(result)) return NextResponse.json({ error: result.error }, { status: result.status });

  await pushToOrchard(id, "adjustment-proposed", `ลูกค้าขอปรับจำนวนสินค้าในออเดอร์ ${id} (${kind} ${deltaQty})`);
  return NextResponse.json({ adjustment: result }, { status: 201 });
}
