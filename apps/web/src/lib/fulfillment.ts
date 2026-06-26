// Phase 4 fulfillment: pure state-machine guards + item-grain money recompute.
// DB-free so they're unit-testable (mirror lib/orders.ts isOrderExpired). All money/state
// mutations themselves live in route handlers inside prisma.$transaction.

import { calcSubTotal, calcFee, calcTransferAmount, round2, type LineInput } from "@/lib/money";

// --- State machines (allowed transitions only) ---

export function canDecideReschedule(status: string): boolean {
  // PENDING -> APPROVED | REJECTED. Terminal otherwise.
  return status === "PENDING";
}

export function canDecideAdjustment(status: string): boolean {
  // PENDING -> APPROVED | REJECTED | CANCELLED. Terminal otherwise.
  return status === "PENDING";
}

export function canCancelAdjustment(status: string): boolean {
  return status === "PENDING";
}

export function canPayIncrease(status: string): boolean {
  // PENDING -> SUCCEEDED (callback) ; PENDING -> EXPIRED (lazy) ; PENDING -> CANCELLED.
  return status === "PENDING";
}

// Lazy expiry for an increase-payment (mirrors isOrderExpired): only PENDING can expire.
export function isIncreasePaymentExpired(
  ip: { status: string; expiresAt: Date | null },
  now: Date = new Date(),
): boolean {
  if (ip.status !== "PENDING") return false;
  if (!ip.expiresAt) return false;
  return now.getTime() > ip.expiresAt.getTime();
}

// Order lifecycle transitions relevant to P4.
const ORDER_TRANSITIONS: Record<string, string[]> = {
  PAID: ["PREPARING", "CANCELLED"],
  PREPARING: ["DELIVERED", "CANCELLED"],
};

export function canTransitionOrder(from: string, to: string): boolean {
  return (ORDER_TRANSITIONS[from] ?? []).includes(to);
}

export function canReview(orderStatus: string): boolean {
  return orderStatus === "DELIVERED";
}

// --- Money math (item grain; reuse lib/money.ts) ---

export interface AdjustResult {
  subTotal: number;
  feeAmount: number;
  vatFeeAmount: number;
  totalAmount: number;
  refundIntentAmount: number;
  transferAmount: number;
  delta: number; // money delta for this adjustment (deltaQty * price)
}

// Recompute order totals after an item-grain qty change.
// `lines` are the order's lines AFTER the qty mutation (REDUCE: -deltaQty / INCREASE: +deltaQty).
// `delta` = deltaQty * price for the changed item. For REDUCE we add `delta` to refundIntent;
// for INCREASE refundIntent is unchanged (buyer pays more, no refund). Customer-pays model:
// total = subTotal; fee/vat are the platform cut deducted at payout (P5).
// transfer = total - fee - vat - refundIntent (roadmap §5 #9).
export function recomputeAdjustment(opts: {
  lines: LineInput[];
  deltaQty: number;
  price: number;
  kind: "REDUCE" | "INCREASE";
  priorRefundIntent: number;
}): AdjustResult {
  const delta = round2(opts.deltaQty * opts.price);
  const subTotal = calcSubTotal(opts.lines);
  const { feeAmount, vatFeeAmount } = calcFee(subTotal);
  const totalAmount = subTotal;
  const refundIntentAmount =
    opts.kind === "REDUCE" ? round2(opts.priorRefundIntent + delta) : round2(opts.priorRefundIntent);
  const transferAmount = calcTransferAmount(totalAmount, feeAmount, vatFeeAmount, refundIntentAmount);
  return { subTotal, feeAmount, vatFeeAmount, totalAmount, refundIntentAmount, transferAmount, delta };
}

// Average rating recompute (roadmap §5 #10). 0 reviews => 0; else rounded to 2dp.
export function recomputeRating(ratings: number[]): number {
  if (ratings.length === 0) return 0;
  return round2(ratings.reduce((s, r) => s + r, 0) / ratings.length);
}

// Increase-payment invoice prefix (disambiguates from order "S..." in the shared callback).
export const INCREASE_PAY_PREFIX = "IP-";

export function isIncreasePayInvoice(invoiceNo: string): boolean {
  return typeof invoiceNo === "string" && invoiceNo.startsWith(INCREASE_PAY_PREFIX);
}
