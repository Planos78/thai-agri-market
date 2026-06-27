import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createOrder, isOrderCreateError, type OrderItemInput } from "@/lib/order-create";

export async function POST(req: Request) {
  const { lineUserId, items, shippingAddress } = (await req.json()) as {
    lineUserId?: string;
    items?: OrderItemInput[];
    shippingAddress?: string;
  };

  if (!lineUserId || !Array.isArray(items) || items.length === 0 || !shippingAddress) {
    return NextResponse.json({ error: "lineUserId, items, shippingAddress required" }, { status: 400 });
  }

  // Gate: only phone-verified LINE users may create an order (AC1).
  const verified = await prisma.verifiedLineUser.findUnique({ where: { lineUserId } });
  if (!verified) {
    return NextResponse.json({ error: "line user not verified" }, { status: 403 });
  }

  // Map LINE identity -> buyer User row.
  const buyer = await prisma.user.upsert({
    where: { lineUserId },
    create: { lineUserId, email: `${lineUserId}@line.local`, name: verified.name, phone: verified.phone, role: "BUYER" },
    update: {},
  });

  // Shared order-create lib (source=LIFF). No money-code duplication with the shop route.
  const result = await createOrder({ buyerId: buyer.id, items, shippingAddress, source: "LIFF" });
  if (isOrderCreateError(result)) return NextResponse.json({ error: result.error }, { status: result.status });

  return NextResponse.json({ order: result.order }, { status: 201 });
}
