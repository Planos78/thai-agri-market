import { NextResponse } from "next/server";
import type { ClaimCategory, ClaimSeverity } from "@prisma/client";
import { requirePerm } from "@/lib/rbac";
import { triageClaim, isClaimError } from "@/lib/claim-tx";

// P6: ops triage. action TRIAGE (OPEN -> TRIAGING) or CLASSIFY (suggestion-only, no transition).
// AI/ops may set category/severity/aiFlag. Human-only (claims.write). Writes a ClaimEvent.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const claims = await requirePerm(req, "claims.write");
  if (claims instanceof NextResponse) return claims;
  const { id } = await params;

  const { action, category, severity, aiFlag, note } = (await req.json()) as {
    action?: "TRIAGE" | "CLASSIFY";
    category?: ClaimCategory;
    severity?: ClaimSeverity;
    aiFlag?: string | null;
    note?: string;
  };
  if (action !== "TRIAGE" && action !== "CLASSIFY") {
    return NextResponse.json({ error: "action must be TRIAGE or CLASSIFY" }, { status: 422 });
  }

  const result = await triageClaim({ claimId: id, action, category, severity, aiFlag, note, actor: claims.sub });
  if (isClaimError(result)) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result);
}
