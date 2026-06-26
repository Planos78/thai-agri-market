import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { generateOrderNo } from "@/lib/order-no";
import { calcSubTotal, calcFee } from "@/lib/money";
import { HOLD_MS } from "@/lib/orders";

interface ItemInput {
  lotId: string;
  quantity: number;
}

export async function POST(req: Request) {
  const { lineUserId, items, shippingAddress } = (await req.json()) as {
    lineUserId?: string;
    items?: ItemInput[];
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

  const lots = await prisma.lot.findMany({ where: { id: { in: items.map((i) => i.lotId) }, status: "ACTIVE", qcStatus: "RELEASED" } });
  const lotById = new Map(lots.map((l) => [l.id, l]));

  const lines: { lotId: string; quantity: number; price: number }[] = [];
  for (const it of items) {
    const lot = lotById.get(it.lotId);
    if (!lot) return NextResponse.json({ error: `lot ${it.lotId} not available` }, { status: 400 });
    if (!Number.isInteger(it.quantity) || it.quantity <= 0) {
      return NextResponse.json({ error: "quantity must be a positive integer" }, { status: 400 });
    }
    if (lot.minOrderQty && it.quantity < lot.minOrderQty) {
      return NextResponse.json({ error: `min order qty for ${lot.fruitName} is ${lot.minOrderQty}` }, { status: 400 });
    }
    lines.push({ lotId: lot.id, quantity: it.quantity, price: Number(lot.price) });
  }

  const subTotal = calcSubTotal(lines);
  const { feeAmount, vatFeeAmount } = calcFee(subTotal);
  // Customer pays subTotal; platform fee/vat are the platform cut (deducted at payout, P5).
  const totalAmount = subTotal;

  const order = await prisma.$transaction(async (tx) => {
    const orderNo = await generateOrderNo(tx, "S");
    return tx.order.create({
      data: {
        orderNo,
        buyerId: buyer.id,
        subTotal,
        feeAmount,
        vatFeeAmount,
        totalAmount,
        status: "WAITING_PAYMENT",
        shippingAddress,
        paymentExpiredAt: new Date(Date.now() + HOLD_MS),
        items: { create: lines.map((l) => ({ lotId: l.lotId, quantity: l.quantity, price: l.price })) },
        payment: { create: { amount: totalAmount, status: "PENDING", escrowStatus: "HELD" } },
      },
      include: { items: true, payment: true },
    });
  });

  return NextResponse.json({ order }, { status: 201 });
}
