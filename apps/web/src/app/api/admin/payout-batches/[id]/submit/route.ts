import { NextResponse } from "next/server";
import { requirePerm } from "@/lib/rbac";
import { submitPayoutBatch, isSettleError } from "@/lib/settlement-tx";

// #6 Submit a DRAFT batch to the mock PSP -> SUBMITTED + pspBatchRef. Human-only (payout.write).
// Mock PSP moves NO real funds (Gate 0); throws loud if a real provider lacks creds.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const claims = await requirePerm(req, "payout.write");
  if (claims instanceof NextResponse) return claims;
  const { id } = await params;

  const result = await submitPayoutBatch({ batchId: id });
  if (isSettleError(result)) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ batch: result });
}
