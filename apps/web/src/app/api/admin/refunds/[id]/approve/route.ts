import { NextResponse } from "next/server";
import { requirePerm } from "@/lib/rbac";
import { approveRefund, isSettleError } from "@/lib/settlement-tx";

// #10 Approve a PENDING refund -> mock PSP, set pspRef + approvedAt. Stays PENDING until the
// callback confirms (mirrors P4 increase-pay). Human-only (refund.write); mock = no real funds.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const claims = await requirePerm(req, "refund.write");
  if (claims instanceof NextResponse) return claims;
  const { id } = await params;

  const result = await approveRefund({ refundId: id });
  if (isSettleError(result)) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ refund: result });
}
