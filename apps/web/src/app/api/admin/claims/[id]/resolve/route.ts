import { NextResponse } from "next/server";
import { requirePerm } from "@/lib/rbac";
import { resolveClaim, isClaimError } from "@/lib/claim-tx";
import type { ResolveDecision } from "@/lib/claim";

const DECISIONS: ResolveDecision[] = ["RESOLVED", "REJECTED", "ESCALATED"];

// P6: human triage decision (RESOLVED|REJECTED|ESCALATED; state machine enforced -> 409 on illegal/
// terminal). RESOLVED + createRefund reuses P5 createRefundInTx (CUSTOMER, PENDING) linked by
// Refund.claimId in ONE tx. Claim never moves money itself. Human-only (claims.write).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const claims = await requirePerm(req, "claims.write");
  if (claims instanceof NextResponse) return claims;
  const { id } = await params;

  const { decision, note, createRefund, refundKind, refundAmount } = (await req.json()) as {
    decision?: ResolveDecision;
    note?: string;
    createRefund?: boolean;
    refundKind?: "FULL" | "PARTIAL";
    refundAmount?: number;
  };
  if (!decision || !DECISIONS.includes(decision)) {
    return NextResponse.json({ error: "decision must be RESOLVED|REJECTED|ESCALATED" }, { status: 422 });
  }

  const result = await resolveClaim({
    claimId: id,
    decision,
    note,
    createRefund: Boolean(createRefund),
    refundKind,
    refundAmount: refundAmount ?? null,
    actor: claims.sub,
  });
  if (isClaimError(result)) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result);
}
