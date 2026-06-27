import type { Prisma, Refund } from "@prisma/client";
import { prisma } from "@/lib/db";
import { generateOrderNo } from "@/lib/order-no";
import { getPsp, PSP_SUCCESS } from "@/lib/psp";
import {
  canSubmitPayoutBatch,
  canSettlePayoutBatch,
  canApproveRefund,
  canSettleRefund,
  canCancelRefund,
  fullRefundAmount,
  isRefundWithinLimit,
  nextRefundedAmount,
  isFullyRefunded,
  batchTotal,
  isPayoutEligibleAmount,
} from "@/lib/settlement";

// Money/state mutations for P5 settlement. Every change is wrapped in prisma.$transaction.
// Payout/refund create/approve/submit are HUMAN-only (gated at route by perm); no auto path.

interface SettleError {
  error: string;
  status: number;
}
function err(error: string, status: number): SettleError {
  return { error, status };
}
function isErr(x: unknown): x is SettleError {
  return typeof x === "object" && x !== null && "error" in x && "status" in x;
}
export { isErr as isSettleError };

// =========================================================================
// Payout batch
// =========================================================================

// Eligible orders for payout: PAID + escrow HELD + transferAmount>0 + orchard has an
// active default PayoutAccount + not already in a non-FAILED batch. Returns rows with
// the resolved payoutAccountId + snapshot amount (= order.transferAmount).
export async function listEligiblePayoutOrders(orderIds: string[]) {
  const orders = await prisma.order.findMany({
    where: { id: { in: orderIds }, status: "PAID" },
    include: { payment: true, items: { select: { lot: { select: { orchardId: true } } } } },
  });
  const result: { orderId: string; payoutAccountId: string; amount: number }[] = [];
  const ineligible: { orderId: string; reason: string }[] = [];

  for (const o of orders) {
    const transfer = Number(o.transferAmount ?? 0);
    if (o.payment?.escrowStatus !== "HELD") {
      ineligible.push({ orderId: o.id, reason: "escrow not HELD" });
      continue;
    }
    if (!isPayoutEligibleAmount(transfer)) {
      ineligible.push({ orderId: o.id, reason: "transferAmount not > 0" });
      continue;
    }
    // Already batched in a non-FAILED batch?
    const existing = await prisma.payoutBatchOrder.findFirst({
      where: { orderId: o.id, batch: { status: { not: "FAILED" } } },
    });
    if (existing) {
      ineligible.push({ orderId: o.id, reason: "already batched" });
      continue;
    }
    // Single-orchard order -> resolve its default active payout account.
    const orchardIds = [...new Set(o.items.map((i) => i.lot.orchardId))];
    if (orchardIds.length !== 1) {
      ineligible.push({ orderId: o.id, reason: "order spans multiple orchards (no single payout account)" });
      continue;
    }
    const acct = await prisma.payoutAccount.findFirst({
      where: { orchardId: orchardIds[0], isActive: true, isDefault: true },
    });
    if (!acct) {
      ineligible.push({ orderId: o.id, reason: "no active default payout account" });
      continue;
    }
    result.push({ orderId: o.id, payoutAccountId: acct.id, amount: transfer });
  }
  const missing = orderIds.filter((id) => !orders.some((o) => o.id === id));
  for (const id of missing) ineligible.push({ orderId: id, reason: "order not found / not PAID" });
  return { eligible: result, ineligible };
}

// Create a DRAFT payout batch from eligible orders. Human-only (perm-gated at route).
export async function createPayoutBatch(opts: { orderIds: string[]; createdBy: string }) {
  if (!Array.isArray(opts.orderIds) || opts.orderIds.length === 0) {
    return err("orderIds required", 422);
  }
  const { eligible, ineligible } = await listEligiblePayoutOrders(opts.orderIds);
  if (eligible.length === 0) {
    return err(`no eligible orders: ${JSON.stringify(ineligible)}`, 422);
  }
  return prisma.$transaction(async (tx) => {
    const batchNo = await generateOrderNo(tx, "PB");
    const total = batchTotal(eligible.map((e) => e.amount));
    const batch = await tx.payoutBatch.create({
      data: {
        batchNo,
        status: "DRAFT",
        totalAmount: total,
        createdBy: opts.createdBy,
        orders: {
          create: eligible.map((e) => ({
            orderId: e.orderId,
            payoutAccountId: e.payoutAccountId,
            amount: e.amount,
          })),
        },
      },
      include: { orders: true },
    });
    return { batch, ineligible };
  });
}

// Submit a DRAFT batch to the (mock) PSP -> SUBMITTED + pspBatchRef. Human-only.
export async function submitPayoutBatch(opts: { batchId: string }) {
  const batch = await prisma.payoutBatch.findUnique({
    where: { id: opts.batchId },
    include: { orders: { include: { order: { select: { orderNo: true } } } } },
  });
  if (!batch) return err("payout batch not found", 404);
  if (!canSubmitPayoutBatch(batch.status)) return err(`batch not DRAFT (${batch.status})`, 409);

  // Mock PSP call (no real funds, Gate 0). Throws loud if a real provider lacks creds.
  const { pspBatchRef } = await getPsp().payout({
    batchNo: batch.batchNo,
    totalAmount: Number(batch.totalAmount),
    orders: batch.orders.map((o) => ({ orderNo: o.order.orderNo, amount: Number(o.amount) })),
  });

  return prisma.$transaction(async (tx) => {
    return tx.payoutBatch.update({
      where: { id: batch.id },
      data: { status: "SUBMITTED", pspBatchRef, submittedAt: new Date() },
    });
  });
}

// Payout callback (HMAC verified at route BEFORE this is called). SUCCEEDED -> each order's
// escrow RELEASED + batch SUCCEEDED; else FAILED + error log. PayoutResponse always written.
export async function applyPayoutCallback(opts: {
  batchNo: string;
  respCode: string;
  pspBatchRef?: string;
  signature?: string;
  rawPayload: string;
}) {
  return prisma.$transaction(async (tx) => {
    const batch = await tx.payoutBatch.findUnique({
      where: { batchNo: opts.batchNo },
      include: { orders: true },
    });
    if (!batch) return { batch: null }; // unknown batchNo -> no response row (FK requires a batch)

    await tx.payoutResponse.create({
      data: {
        payoutBatchId: batch.id,
        respCode: String(opts.respCode),
        pspBatchRef: opts.pspBatchRef ?? null,
        signature: opts.signature ?? null,
        rawPayload: opts.rawPayload,
        accepted: String(opts.respCode) === PSP_SUCCESS,
      },
    });

    if (!canSettlePayoutBatch(batch.status)) return { batch }; // terminal re-callback: no-op

    if (String(opts.respCode) === PSP_SUCCESS) {
      for (const o of batch.orders) {
        await tx.payment.update({
          where: { orderId: o.orderId },
          data: { escrowStatus: "RELEASED" },
        });
      }
      const updated = await tx.payoutBatch.update({
        where: { id: batch.id },
        data: { status: "SUCCEEDED", settledAt: new Date() },
      });
      return { batch: updated };
    }

    await tx.payoutErrorLog.create({
      data: {
        payoutBatchId: batch.id,
        errorCode: String(opts.respCode),
        errorMessage: `payout failed (respCode=${opts.respCode})`,
        rawPayload: opts.rawPayload,
      },
    });
    const updated = await tx.payoutBatch.update({
      where: { id: batch.id },
      data: { status: "FAILED" },
    });
    return { batch: updated };
  });
}

// =========================================================================
// Refund
// =========================================================================

// Create a PENDING refund inside an EXISTING transaction. Same logic as createRefund, but
// runs on the caller's tx so it can be composed atomically (P6: claim resolution + refund in
// one $transaction). `claimId` links the refund 1:1 to a Claim when called from claim-resolve.
export async function createRefundInTx(
  tx: Prisma.TransactionClient,
  opts: {
    orderId: string;
    kind: "FULL" | "PARTIAL";
    orderAdjustmentId?: string | null;
    amount?: number | null;
    payoutType?: "CUSTOMER" | "PLANT";
    approvedBy: string;
    claimId?: string | null;
  },
): Promise<{ refund: Refund } | SettleError> {
  // BUG-B fix: lock the order row FOR UPDATE (mirrors order-no.ts) so two concurrent refund
  // creates serialize on the same row and cannot both pass the over-refund check (closes TOCTOU).
  const locked = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "Order" WHERE "id" = ${opts.orderId} FOR UPDATE`;
  if (locked.length === 0) return err("order not found", 404);

  const order = await tx.order.findUnique({ where: { id: opts.orderId } });
  if (!order) return err("order not found", 404);

  // Count ALL non-terminal-failed refunds (PENDING + SUCCEEDED), not just order.refundedAmount
  // (which counts SUCCEEDED only). In-flight PENDING refunds must count toward the limit.
  const inFlight = await tx.refund.aggregate({
    where: { orderId: opts.orderId, status: { in: ["PENDING", "SUCCEEDED"] } },
    _sum: { amount: true },
  });
  const committedOrInFlight = Number(inFlight._sum.amount ?? 0);

  let amount: number;
  let orderAdjustmentId: string | null = null;

  if (opts.kind === "PARTIAL") {
    if (opts.orderAdjustmentId) {
      const adj = await tx.orderAdjustment.findUnique({
        where: { id: opts.orderAdjustmentId },
        include: { refund: true },
      });
      if (!adj || adj.orderId !== opts.orderId) return err("adjustment not found", 404);
      if (adj.kind !== "REDUCE") return err("only a REDUCE adjustment can become a refund", 422);
      if (adj.status !== "APPROVED") return err("adjustment must be APPROVED", 409);
      if (adj.refund) return err("adjustment already has a refund", 409);
      amount = Number(adj.amount);
      orderAdjustmentId = adj.id;
    } else if (opts.amount != null) {
      // P6: claim-driven PARTIAL refund — explicit amount, validated against the over-refund limit.
      amount = Number(opts.amount);
      if (!(amount > 0)) return err("refund amount must be > 0", 422);
    } else {
      return err("orderAdjustmentId or amount required for PARTIAL refund", 422);
    }
  } else {
    // FULL: refund the remaining unrefunded/uncommitted balance (totalAmount minus everything
    // already SUCCEEDED or in-flight PENDING). Ignore client amount.
    amount = fullRefundAmount(Number(order.totalAmount), committedOrInFlight);
    if (!(amount > 0)) return err("refund exceeds order total (over-refund)", 422);
  }

  if (
    !isRefundWithinLimit({
      totalAmount: Number(order.totalAmount),
      committedOrInFlight,
      amount,
    })
  ) {
    return err("refund exceeds order total (over-refund)", 422);
  }

  const refundNo = await generateOrderNo(tx, "RF");
  const refund = await tx.refund.create({
    data: {
      refundNo,
      orderId: opts.orderId,
      orderAdjustmentId,
      claimId: opts.claimId ?? null,
      amount,
      kind: opts.kind,
      payoutType: opts.payoutType ?? "CUSTOMER",
      status: "PENDING",
      approvedBy: opts.approvedBy,
    },
  });
  return { refund };
}

// Create a PENDING refund. PARTIAL converts an APPROVED REDUCE adjustment (amount = adj.amount);
// FULL refunds the remaining order total. Over-refund invariant rejected (422). Human-only.
export async function createRefund(opts: {
  orderId: string;
  kind: "FULL" | "PARTIAL";
  orderAdjustmentId?: string | null;
  amount?: number | null;
  payoutType?: "CUSTOMER" | "PLANT";
  approvedBy: string;
}) {
  return prisma.$transaction((tx) => createRefundInTx(tx, opts));
}

// Approve a PENDING refund -> call mock PSP, set pspRef + approvedAt. Stays PENDING until
// callback (mirrors P4 increase-pay). Human-only.
export async function approveRefund(opts: { refundId: string }) {
  const refund = await prisma.refund.findUnique({ where: { id: opts.refundId } });
  if (!refund) return err("refund not found", 404);
  if (!canApproveRefund(refund.status)) return err(`refund not PENDING (${refund.status})`, 409);

  const { pspRef } = await getPsp().refund({ refundNo: refund.refundNo, amount: Number(refund.amount) });

  return prisma.$transaction(async (tx) => {
    return tx.refund.update({
      where: { id: refund.id },
      data: { pspRef, approvedAt: new Date() },
    });
  });
}

// Cancel a PENDING refund before approve. Human-only.
export async function cancelRefund(opts: { refundId: string }) {
  return prisma.$transaction(async (tx) => {
    const refund = await tx.refund.findUnique({ where: { id: opts.refundId } });
    if (!refund) return err("refund not found", 404);
    if (!canCancelRefund(refund.status)) return err(`refund not PENDING (${refund.status})`, 409);
    return tx.refund.update({ where: { id: refund.id }, data: { status: "CANCELLED" } });
  });
}

// Refund callback (HMAC verified at route BEFORE this). SUCCEEDED -> order.refundedAmount +=
// amount; full -> escrow + payment REFUNDED. Correlate by pspRef. Atomic.
export async function applyRefundCallback(opts: { pspRef: string; respCode: string }) {
  return prisma.$transaction(async (tx) => {
    const refund = await tx.refund.findFirst({ where: { pspRef: opts.pspRef } });
    if (!refund) return { refund: null };
    if (!canSettleRefund(refund.status)) return { refund }; // terminal re-callback: no-op

    if (String(opts.respCode) !== PSP_SUCCESS) {
      const failed = await tx.refund.update({ where: { id: refund.id }, data: { status: "FAILED" } });
      return { refund: failed };
    }

    const order = await tx.order.findUniqueOrThrow({ where: { id: refund.orderId } });
    const newRefunded = nextRefundedAmount(Number(order.refundedAmount), Number(refund.amount));
    await tx.order.update({ where: { id: order.id }, data: { refundedAmount: newRefunded } });

    if (isFullyRefunded(Number(order.totalAmount), newRefunded)) {
      await tx.payment.update({
        where: { orderId: order.id },
        data: { status: "REFUNDED", escrowStatus: "REFUNDED" },
      });
    }

    const settled = await tx.refund.update({
      where: { id: refund.id },
      data: { status: "SUCCEEDED", settledAt: new Date() },
    });
    return { refund: settled };
  });
}
