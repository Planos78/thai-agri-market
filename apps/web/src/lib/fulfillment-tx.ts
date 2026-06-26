import { prisma } from "@/lib/db";
import { HOLD_MS } from "@/lib/orders";
import {
  canDecideReschedule,
  canDecideAdjustment,
  recomputeAdjustment,
  INCREASE_PAY_PREFIX,
} from "@/lib/fulfillment";
import { generateOrderNo } from "@/lib/order-no";
import { calcTransferAmount } from "@/lib/money";
import type { LineInput } from "@/lib/money";

export type Decision = "APPROVE" | "REJECT";

interface DecideError {
  error: string;
  status: number;
}
function err(error: string, status: number): DecideError {
  return { error, status };
}
function isErr(x: unknown): x is DecideError {
  return typeof x === "object" && x !== null && "error" in x && "status" in x;
}
export { isErr as isDecideError };

// --- Reschedule decide (shared by admin #4 + buyer #3) ---
// APPROVE: Order.deliveryDate = proposedDate. REJECT(+unfulfillable): Order CANCELLED +
// accumulate full-order refund intent. decidedBy = admin sub or buyer lineUserId.
export async function decideReschedule(opts: {
  orderId: string;
  rescheduleId: string;
  decision: Decision;
  decidedBy: string;
  unfulfillable?: boolean; // REJECT path: order can no longer be fulfilled -> cancel + refund
}) {
  return prisma.$transaction(async (tx) => {
    const r = await tx.deliveryReschedule.findUnique({ where: { id: opts.rescheduleId } });
    if (!r || r.orderId !== opts.orderId) return err("reschedule not found", 404);
    if (!canDecideReschedule(r.status)) return err(`reschedule not pending (${r.status})`, 409);

    const order = await tx.order.findUnique({ where: { id: opts.orderId } });
    if (!order) return err("order not found", 404);

    if (opts.decision === "APPROVE") {
      const reschedule = await tx.deliveryReschedule.update({
        where: { id: r.id },
        data: { status: "APPROVED", decidedBy: opts.decidedBy, decidedAt: new Date() },
      });
      const updated = await tx.order.update({
        where: { id: order.id },
        data: { deliveryDate: r.proposedDate },
      });
      return { order: updated, reschedule };
    }

    // REJECT
    const reschedule = await tx.deliveryReschedule.update({
      where: { id: r.id },
      data: { status: "REJECTED", decidedBy: opts.decidedBy, decidedAt: new Date() },
    });
    if (opts.unfulfillable) {
      // Cancel order + accumulate full-order refund intent (total still owed to buyer at P5).
      const refundIntentAmount = Number(order.totalAmount);
      const transferAmount = calcTransferAmount(
        Number(order.totalAmount),
        Number(order.feeAmount),
        Number(order.vatFeeAmount),
        refundIntentAmount,
      );
      const updated = await tx.order.update({
        where: { id: order.id },
        data: { status: "CANCELLED", refundIntentAmount, transferAmount },
      });
      return { order: updated, reschedule };
    }
    return { order, reschedule };
  });
}

// Supersede any prior PENDING reschedule for an order, then create a new PENDING one (one tx).
export async function proposeReschedule(opts: {
  orderId: string;
  proposedDate: Date;
  proposedBy: "ORCHARD" | "BUYER";
  note?: string | null;
}) {
  return prisma.$transaction(async (tx) => {
    await tx.deliveryReschedule.updateMany({
      where: { orderId: opts.orderId, status: "PENDING" },
      data: { status: "REJECTED", decidedAt: new Date() },
    });
    return tx.deliveryReschedule.create({
      data: {
        orderId: opts.orderId,
        proposedDate: opts.proposedDate,
        proposedBy: opts.proposedBy,
        note: opts.note ?? null,
        status: "PENDING",
      },
    });
  });
}

// --- Adjustment propose (#5 admin / #6 buyer) ---
// amount = deltaQty * orderItem.price; create PENDING. Guard item belongs to order.
export async function proposeAdjustment(opts: {
  orderId: string;
  orderItemId: string;
  kind: "REDUCE" | "INCREASE";
  deltaQty: number;
  proposedBy: "ORCHARD" | "BUYER";
  note?: string | null;
}) {
  const item = await prisma.orderItem.findUnique({ where: { id: opts.orderItemId } });
  if (!item || item.orderId !== opts.orderId) return err("order item not found", 404);
  if (!Number.isInteger(opts.deltaQty) || opts.deltaQty <= 0) return err("deltaQty must be a positive integer", 422);
  if (opts.kind !== "REDUCE" && opts.kind !== "INCREASE") return err("invalid kind", 422);
  if (opts.kind === "REDUCE" && opts.deltaQty > item.quantity) {
    return err("REDUCE deltaQty exceeds item quantity", 422);
  }
  const amount = Math.round(opts.deltaQty * Number(item.price) * 100) / 100;
  return prisma.orderAdjustment.create({
    data: {
      orderId: opts.orderId,
      orderItemId: opts.orderItemId,
      kind: opts.kind,
      deltaQty: opts.deltaQty,
      amount,
      proposedBy: opts.proposedBy,
      note: opts.note ?? null,
      status: "PENDING",
    },
  });
}

// --- Adjustment decide (#7) ---
// APPROVE: mutate OrderItem.qty; recompute totals (item grain); REDUCE -> refundIntent;
// INCREASE -> create IncreasePayment(PENDING). REJECT: just mark REJECTED. All in one tx.
export async function decideAdjustment(opts: {
  orderId: string;
  adjustmentId: string;
  decision: Decision;
  decidedBy: string;
}) {
  return prisma.$transaction(async (tx) => {
    const adj = await tx.orderAdjustment.findUnique({ where: { id: opts.adjustmentId } });
    if (!adj || adj.orderId !== opts.orderId) return err("adjustment not found", 404);
    if (!canDecideAdjustment(adj.status)) return err(`adjustment not pending (${adj.status})`, 409);

    if (opts.decision === "REJECT") {
      const adjustment = await tx.orderAdjustment.update({
        where: { id: adj.id },
        data: { status: "REJECTED", decidedBy: opts.decidedBy, decidedAt: new Date() },
      });
      return { adjustment };
    }

    // APPROVE
    const item = await tx.orderItem.findUnique({ where: { id: adj.orderItemId }, include: { lot: true } });
    if (!item) return err("order item not found", 404);
    const order = await tx.order.findUnique({ where: { id: opts.orderId }, include: { items: true } });
    if (!order) return err("order not found", 404);

    // Guards at decide-time (qty/stock may have changed since propose).
    if (adj.kind === "REDUCE" && adj.deltaQty > item.quantity) {
      return err("REDUCE deltaQty exceeds current item quantity", 422);
    }
    if (adj.kind === "INCREASE" && adj.deltaQty > item.lot.quantity) {
      return err("INCREASE deltaQty exceeds available lot quantity", 422);
    }

    const newQty = adj.kind === "REDUCE" ? item.quantity - adj.deltaQty : item.quantity + adj.deltaQty;

    // Build the post-mutation line set.
    const lines: LineInput[] = order.items.map((it) =>
      it.id === item.id
        ? { quantity: newQty, price: Number(item.price) }
        : { quantity: it.quantity, price: Number(it.price) },
    );
    const money = recomputeAdjustment({
      lines,
      deltaQty: adj.deltaQty,
      price: Number(item.price),
      kind: adj.kind,
      priorRefundIntent: Number(order.refundIntentAmount),
    });

    await tx.orderItem.update({ where: { id: item.id }, data: { quantity: newQty } });

    // Full-reduce to 0 on the only remaining item => cancel order + full refund intent.
    const remainingQty = lines.reduce((s, l) => s + l.quantity, 0);
    const cancelled = adj.kind === "REDUCE" && remainingQty === 0;

    const updatedOrder = await tx.order.update({
      where: { id: order.id },
      data: {
        subTotal: money.subTotal,
        feeAmount: money.feeAmount,
        vatFeeAmount: money.vatFeeAmount,
        totalAmount: money.totalAmount,
        refundIntentAmount: money.refundIntentAmount,
        transferAmount: money.transferAmount,
        ...(cancelled ? { status: "CANCELLED" } : {}),
      },
    });

    const adjustment = await tx.orderAdjustment.update({
      where: { id: adj.id },
      data: { status: "APPROVED", amount: money.delta, decidedBy: opts.decidedBy, decidedAt: new Date() },
    });

    let increasePayment = null;
    if (adj.kind === "INCREASE") {
      const invoiceNo = `${INCREASE_PAY_PREFIX}${await generateOrderNo(tx, "S")}`;
      increasePayment = await tx.increasePayment.create({
        data: {
          adjustmentId: adj.id,
          orderId: order.id,
          amount: money.delta,
          status: "PENDING",
          pspRef: invoiceNo, // invoiceNo reserved at approve; pay re-confirms via PSP
          expiresAt: new Date(Date.now() + HOLD_MS),
        },
      });
    }

    return { order: updatedOrder, adjustment, increasePayment };
  });
}

// --- Adjustment cancel (#8) ---
export async function cancelAdjustment(opts: { orderId: string; adjustmentId: string }) {
  return prisma.$transaction(async (tx) => {
    const adj = await tx.orderAdjustment.findUnique({ where: { id: opts.adjustmentId } });
    if (!adj || adj.orderId !== opts.orderId) return err("adjustment not found", 404);
    if (adj.status !== "PENDING") return err(`adjustment not pending (${adj.status})`, 409);
    const adjustment = await tx.orderAdjustment.update({
      where: { id: adj.id },
      data: { status: "CANCELLED" },
    });
    // Cancel child increase-payment if somehow present (defensive; INCREASE creates it only on approve).
    await tx.increasePayment.updateMany({
      where: { adjustmentId: adj.id, status: "PENDING" },
      data: { status: "CANCELLED" },
    });
    return { adjustment };
  });
}
