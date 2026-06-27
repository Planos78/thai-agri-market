import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { shopSessionFromRequest } from "@/lib/auth";
import { createOrder, isOrderCreateError, type OrderItemInput } from "@/lib/order-create";

// #15 Create a web (SHOP) order. Gates on a valid shop session whose phone matches the body.
// Upserts a buyer User by phone (email = "<phone>@shop.local"). Shared order-create lib.
export async function POST(req: Request) {
  const session = await shopSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "shop session required (verify phone first)" }, { status: 403 });
  }

  const { items, shippingAddress, phone } = (await req.json()) as {
    items?: OrderItemInput[];
    shippingAddress?: string;
    phone?: string;
  };
  if (phone && phone !== session.phone) {
    return NextResponse.json({ error: "phone does not match session" }, { status: 403 });
  }
  if (!Array.isArray(items) || items.length === 0 || !shippingAddress) {
    return NextResponse.json({ error: "items and shippingAddress required" }, { status: 400 });
  }

  // Buyer identity from the verified phone (no LINE; email is a stable synthetic key).
  const email = `${session.phone}@shop.local`;
  const buyer = await prisma.user.upsert({
    where: { email },
    create: { email, phone: session.phone, role: "BUYER" },
    update: { phone: session.phone },
  });

  const result = await createOrder({ buyerId: buyer.id, items, shippingAddress, source: "SHOP" });
  if (isOrderCreateError(result)) return NextResponse.json({ error: result.error }, { status: result.status });

  return NextResponse.json({ order: result.order }, { status: 201 });
}
