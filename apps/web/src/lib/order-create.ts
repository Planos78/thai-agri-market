import { prisma } from "@/lib/db";
import { generateOrderNo } from "@/lib/order-no";
import { calcSubTotal, calcFee, getRates } from "@/lib/money";
import { HOLD_MS } from "@/lib/orders";

// Shared order-create logic. LIFF (source=LIFF) and web shop (source=SHOP) both call this.
// No money-code duplication: lot validation + calcSubTotal/calcFee + order-no in $tx + Payment.
// Take-rate/VAT sourced from the active PlatformConfig row (env fallback) via getRates().

export interface OrderItemInput {
  lotId: string;
  quantity: number;
}

interface CreateError {
  error: string;
  status: number;
}
function err(error: string, status: number): CreateError {
  return { error, status };
}
function isErr(x: unknown): x is CreateError {
  return typeof x === "object" && x !== null && "error" in x && "status" in x;
}
export { isErr as isOrderCreateError };

export async function createOrder(opts: {
  buyerId: string;
  items: OrderItemInput[];
  shippingAddress: string;
  source: "LIFF" | "SHOP";
}) {
  if (!Array.isArray(opts.items) || opts.items.length === 0 || !opts.shippingAddress) {
    return err("items and shippingAddress required", 400);
  }

  const lots = await prisma.lot.findMany({
    where: { id: { in: opts.items.map((i) => i.lotId) }, status: "ACTIVE", qcStatus: "RELEASED" },
  });
  const lotById = new Map(lots.map((l) => [l.id, l]));

  const lines: { lotId: string; quantity: number; price: number }[] = [];
  for (const it of opts.items) {
    const lot = lotById.get(it.lotId);
    if (!lot) return err(`lot ${it.lotId} not available`, 400);
    if (!Number.isInteger(it.quantity) || it.quantity <= 0) {
      return err("quantity must be a positive integer", 400);
    }
    if (lot.minOrderQty && it.quantity < lot.minOrderQty) {
      return err(`min order qty for ${lot.fruitName} is ${lot.minOrderQty}`, 400);
    }
    lines.push({ lotId: lot.id, quantity: it.quantity, price: Number(lot.price) });
  }

  const { takeRate, vatRate } = await getRates();
  const subTotal = calcSubTotal(lines);
  const { feeAmount, vatFeeAmount } = calcFee(subTotal, takeRate, vatRate);
  // Customer pays subTotal; platform fee/vat are the platform cut (deducted at payout, P5).
  const totalAmount = subTotal;

  const order = await prisma.$transaction(async (tx) => {
    const orderNo = await generateOrderNo(tx, "S");
    return tx.order.create({
      data: {
        orderNo,
        buyerId: opts.buyerId,
        subTotal,
        feeAmount,
        vatFeeAmount,
        totalAmount,
        source: opts.source,
        status: "WAITING_PAYMENT",
        shippingAddress: opts.shippingAddress,
        paymentExpiredAt: new Date(Date.now() + HOLD_MS),
        items: { create: lines.map((l) => ({ lotId: l.lotId, quantity: l.quantity, price: l.price })) },
        payment: { create: { amount: totalAmount, status: "PENDING", escrowStatus: "HELD" } },
      },
      include: { items: true, payment: true },
    });
  });

  return { order };
}
