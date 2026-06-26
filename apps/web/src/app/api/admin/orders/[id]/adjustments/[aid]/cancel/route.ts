import { NextResponse } from "next/server";
import { requirePerm } from "@/lib/rbac";
import { requireOrderScope } from "@/lib/fulfillment-scope";
import { cancelAdjustment, isDecideError } from "@/lib/fulfillment-tx";

// #8 Proposer/operator withdraws a PENDING adjustment. PENDING->CANCELLED (one tx).
export async function POST(req: Request, { params }: { params: Promise<{ id: string; aid: string }> }) {
  const claims = await requirePerm(req, "fulfillment.adjust");
  if (claims instanceof NextResponse) return claims;
  const { id, aid } = await params;
  const scopeErr = await requireOrderScope(claims, id);
  if (scopeErr) return scopeErr;

  const result = await cancelAdjustment({ orderId: id, adjustmentId: aid });
  if (isDecideError(result)) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result);
}
