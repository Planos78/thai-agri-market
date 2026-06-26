import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { resolveBuyerOrder } from "@/lib/fulfillment-scope";
import { canReview, recomputeRating } from "@/lib/fulfillment";

// #14 Buyer submits a review (only when DELIVERED). One per order; recompute Orchard.rating (tx).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { lineUserId, rating, comment } = (await req.json()) as {
    lineUserId?: string;
    rating?: number;
    comment?: string;
  };

  const owner = await resolveBuyerOrder(id, lineUserId);
  if (owner instanceof NextResponse) return owner;

  if (!Number.isInteger(rating) || (rating as number) < 1 || (rating as number) > 5) {
    return NextResponse.json({ error: "rating must be an integer 1-5" }, { status: 422 });
  }

  const order = await prisma.order.findUnique({
    where: { id },
    include: { items: { include: { lot: { select: { orchardId: true } } } } },
  });
  if (!order) return NextResponse.json({ error: "order not found" }, { status: 404 });
  if (!canReview(order.status)) {
    return NextResponse.json({ error: `order not delivered (${order.status})` }, { status: 409 });
  }

  const existing = await prisma.review.findFirst({ where: { orderId: id } });
  if (existing) return NextResponse.json({ error: "order already reviewed" }, { status: 409 });

  const orchardId = order.items[0]?.lot.orchardId;
  if (!orchardId) return NextResponse.json({ error: "order has no orchard" }, { status: 409 });

  const result = await prisma.$transaction(async (tx) => {
    const review = await tx.review.create({
      data: { userId: owner.buyerId, orchardId, orderId: id, rating: rating as number, comment: comment ?? null },
    });
    const reviews = await tx.review.findMany({ where: { orchardId }, select: { rating: true } });
    const orchardRating = recomputeRating(reviews.map((r) => r.rating));
    await tx.orchard.update({ where: { id: orchardId }, data: { rating: orchardRating } });
    return { review, orchardRating };
  });

  return NextResponse.json(result, { status: 201 });
}
