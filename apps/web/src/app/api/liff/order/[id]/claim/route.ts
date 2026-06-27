import { NextResponse } from "next/server";
import type { ClaimCategory } from "@prisma/client";
import { resolveBuyerOrder } from "@/lib/fulfillment-scope";
import { fileClaim, isClaimError } from "@/lib/claim-tx";

const CATEGORIES: ClaimCategory[] = ["DAMAGED", "QUALITY", "MISSING", "OTHER"];

// P6 Flow 7: a verified LINE buyer files a claim for their own order -> OPEN. Evidence images
// are uploaded separately. Buyer-file is the only path that creates a claim.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { lineUserId, category, description } = (await req.json()) as {
    lineUserId?: string;
    category?: ClaimCategory;
    description?: string;
  };

  const owner = await resolveBuyerOrder(id, lineUserId);
  if (owner instanceof NextResponse) return owner;

  if (!category || !CATEGORIES.includes(category)) {
    return NextResponse.json({ error: "category must be one of DAMAGED|QUALITY|MISSING|OTHER" }, { status: 422 });
  }

  const result = await fileClaim({
    orderId: id,
    buyerId: owner.buyerId,
    lineUserId: owner.lineUserId,
    category,
    description: description ?? "",
    actor: owner.lineUserId,
  });
  if (isClaimError(result)) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result, { status: 201 });
}
