import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/rbac";
import { createPayoutBatch, isSettleError } from "@/lib/settlement-tx";

// #4 List payout batches (optionally by status). Human-only (payout.read).
export async function GET(req: Request) {
  const claims = await requirePerm(req, "payout.read");
  if (claims instanceof NextResponse) return claims;
  const status = new URL(req.url).searchParams.get("status") ?? undefined;
  const batches = await prisma.payoutBatch.findMany({
    where: status ? { status: status as never } : undefined,
    include: { orders: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ batches });
}

// #5 Create a DRAFT payout batch from eligible PAID+HELD orders. Human-only (payout.write).
// totalAmount = sum(transfer>0); excludes transfer=0; rejects if none eligible.
export async function POST(req: Request) {
  const claims = await requirePerm(req, "payout.write");
  if (claims instanceof NextResponse) return claims;

  const { orderIds } = (await req.json()) as { orderIds?: string[] };
  if (!Array.isArray(orderIds) || orderIds.length === 0) {
    return NextResponse.json({ error: "orderIds required" }, { status: 422 });
  }

  const result = await createPayoutBatch({ orderIds, createdBy: claims.sub });
  if (isSettleError(result)) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result, { status: 201 });
}
