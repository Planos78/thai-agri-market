import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { scopedOrchardIds, inScope } from "@/lib/rbac";
import type { AdminClaims } from "@/lib/auth";

// Resolve the set of orchards an order touches (multi-lot cart: all item lots' orchards).
export async function orderOrchardIds(orderId: string): Promise<string[]> {
  const items = await prisma.orderItem.findMany({
    where: { orderId },
    select: { lot: { select: { orchardId: true } } },
  });
  return [...new Set(items.map((i) => i.lot.orchardId))];
}

// Admin must be in scope for EVERY orchard the order touches. Returns null if ok, else 403.
export async function requireOrderScope(
  claims: AdminClaims,
  orderId: string,
): Promise<NextResponse | null> {
  const scope = await scopedOrchardIds(claims);
  const orchardIds = await orderOrchardIds(orderId);
  if (orchardIds.length === 0 || !orchardIds.every((oid) => inScope(scope, oid))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return null;
}

// Push every orchard's bound LINE staff (P3 OrchardLineBinding). Best-effort relay.
export async function pushToOrchard(orderId: string, event: string, message: string): Promise<void> {
  const { relayPush } = await import("@/lib/line");
  const orchardIds = await orderOrchardIds(orderId);
  const bindings = await prisma.orchardLineBinding.findMany({
    where: { orchardId: { in: orchardIds } },
    select: { lineUserId: true },
  });
  for (const b of bindings) await relayPush(event, b.lineUserId, message);
}

// Resolve a verified LINE user that owns the order. Returns the buyer's lineUserId+order
// or a NextResponse error (403 not verified / not owner, 404 order missing).
export async function resolveBuyerOrder(
  orderId: string,
  lineUserId: string | undefined,
): Promise<NextResponse | { lineUserId: string; buyerId: string }> {
  if (!lineUserId) return NextResponse.json({ error: "lineUserId required" }, { status: 403 });
  const verified = await prisma.verifiedLineUser.findUnique({ where: { lineUserId } });
  if (!verified) return NextResponse.json({ error: "line user not verified" }, { status: 403 });
  const buyer = await prisma.user.findUnique({ where: { lineUserId } });
  if (!buyer) return NextResponse.json({ error: "buyer not found" }, { status: 403 });
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { buyerId: true } });
  if (!order) return NextResponse.json({ error: "order not found" }, { status: 404 });
  if (order.buyerId !== buyer.id) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return { lineUserId, buyerId: buyer.id };
}

// Buyer's own lineUserId for an order (for push from admin-side actions).
export async function orderBuyerLineUserId(orderId: string): Promise<string | null> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { buyer: { select: { lineUserId: true } } },
  });
  return order?.buyer.lineUserId ?? null;
}
