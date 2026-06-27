import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/rbac";
import { createRefund, isSettleError } from "@/lib/settlement-tx";

// #8 List refunds (optionally by order/status). Human-only (refund.read).
export async function GET(req: Request) {
  const claims = await requirePerm(req, "refund.read");
  if (claims instanceof NextResponse) return claims;
  const sp = new URL(req.url).searchParams;
  const orderId = sp.get("orderId") ?? undefined;
  const status = sp.get("status") ?? undefined;
  const refunds = await prisma.refund.findMany({
    where: {
      ...(orderId ? { orderId } : {}),
      ...(status ? { status: status as never } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ refunds });
}

// #9 Create a PENDING refund. PARTIAL converts an APPROVED REDUCE adjustment; FULL refunds
// the remaining order total. Over-refund rejected (422). Human-only (refund.write).
export async function POST(req: Request) {
  const claims = await requirePerm(req, "refund.write");
  if (claims instanceof NextResponse) return claims;

  const { orderId, kind, amount, orderAdjustmentId, payoutType } = (await req.json()) as {
    orderId?: string;
    kind?: "FULL" | "PARTIAL";
    amount?: number;
    orderAdjustmentId?: string;
    payoutType?: "CUSTOMER" | "PLANT";
  };
  if (!orderId || (kind !== "FULL" && kind !== "PARTIAL")) {
    return NextResponse.json({ error: "orderId and kind (FULL|PARTIAL) required" }, { status: 422 });
  }

  const result = await createRefund({
    orderId,
    kind,
    amount: amount ?? null,
    orderAdjustmentId: orderAdjustmentId ?? null,
    payoutType,
    approvedBy: claims.sub,
  });
  if (isSettleError(result)) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result, { status: 201 });
}
