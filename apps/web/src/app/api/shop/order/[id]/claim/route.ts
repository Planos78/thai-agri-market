import { NextResponse } from "next/server";
import type { ClaimCategory } from "@prisma/client";
import { prisma } from "@/lib/db";
import { shopSessionFromRequest } from "@/lib/auth";
import { fileClaim, isClaimError } from "@/lib/claim-tx";

const CATEGORIES: ClaimCategory[] = ["DAMAGED", "QUALITY", "MISSING", "OTHER"];

// P6 Flow 7: a shop buyer (phone session) files a claim for their own order -> OPEN.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await shopSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "shop session required" }, { status: 403 });
  const { id } = await params;

  const order = await prisma.order.findUnique({ where: { id }, include: { buyer: { select: { id: true, phone: true } } } });
  if (!order) return NextResponse.json({ error: "order not found" }, { status: 404 });
  if (order.buyer.phone !== session.phone) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { category, description } = (await req.json()) as { category?: ClaimCategory; description?: string };
  if (!category || !CATEGORIES.includes(category)) {
    return NextResponse.json({ error: "category must be one of DAMAGED|QUALITY|MISSING|OTHER" }, { status: 422 });
  }

  const result = await fileClaim({
    orderId: id,
    buyerId: order.buyer.id,
    category,
    description: description ?? "",
    actor: session.phone,
  });
  if (isClaimError(result)) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result, { status: 201 });
}
