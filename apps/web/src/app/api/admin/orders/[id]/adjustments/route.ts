import { NextResponse } from "next/server";
import { requirePerm } from "@/lib/rbac";
import { requireOrderScope, orderBuyerLineUserId } from "@/lib/fulfillment-scope";
import { proposeAdjustment, isDecideError } from "@/lib/fulfillment-tx";
import { relayPush } from "@/lib/line";

// #5 Orchard (admin) proposes an item-grain qty adjustment (REDUCE/INCREASE). Creates PENDING.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const claims = await requirePerm(req, "fulfillment.adjust");
  if (claims instanceof NextResponse) return claims;
  const { id } = await params;
  const scopeErr = await requireOrderScope(claims, id);
  if (scopeErr) return scopeErr;

  const { orderItemId, kind, deltaQty, note } = (await req.json()) as {
    orderItemId?: string;
    kind?: "REDUCE" | "INCREASE";
    deltaQty?: number;
    note?: string;
  };
  if (!orderItemId || !kind || deltaQty == null) {
    return NextResponse.json({ error: "orderItemId, kind, deltaQty required" }, { status: 400 });
  }

  const result = await proposeAdjustment({ orderId: id, orderItemId, kind, deltaQty, proposedBy: "ORCHARD", note });
  if (isDecideError(result)) return NextResponse.json({ error: result.error }, { status: result.status });

  const buyerLine = await orderBuyerLineUserId(id);
  if (buyerLine) {
    await relayPush("adjustment-proposed", buyerLine, `สวนขอปรับจำนวนสินค้าในออเดอร์ ${id} (${kind} ${deltaQty})`);
  }
  return NextResponse.json({ adjustment: result }, { status: 201 });
}
