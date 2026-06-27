// Phase 5 settlement: pure state-machine guards + payout/refund money helpers.
// DB-free so they're unit-testable (mirror lib/fulfillment.ts). All money/state
// mutations live in lib/settlement-tx.ts inside prisma.$transaction.

import { round2 } from "@/lib/money";

// --- State machines (allowed transitions only) ---

export function canSubmitPayoutBatch(status: string): boolean {
  // DRAFT -> SUBMITTED only.
  return status === "DRAFT";
}

export function canSettlePayoutBatch(status: string): boolean {
  // SUBMITTED -> SUCCEEDED | FAILED only (callback). Terminal otherwise.
  return status === "SUBMITTED";
}

export function canApproveRefund(status: string): boolean {
  // PENDING -> (approve reserves pspRef; stays PENDING) ; only PENDING is approvable.
  return status === "PENDING";
}

export function canSettleRefund(status: string): boolean {
  // PENDING -> SUCCEEDED | FAILED only (callback). Terminal otherwise.
  return status === "PENDING";
}

export function canCancelRefund(status: string): boolean {
  // PENDING -> CANCELLED (before approve).
  return status === "PENDING";
}

// --- Refund amount math (full / partial; item-grain consistent with P4) ---

// FULL refund of remaining = totalAmount - refundedAmount.
export function fullRefundAmount(totalAmount: number, refundedAmount: number): number {
  return round2(totalAmount - refundedAmount);
}

// Over-refund invariant: (sum of all non-terminal-failed refunds) + amount must not exceed
// totalAmount. BUG-B fix: `committedOrInFlight` must count PENDING + SUCCEEDED refunds
// (exclude only FAILED/CANCELLED), not just the SUCCEEDED running total (order.refundedAmount).
// Counting in-flight PENDING refunds is what stops two overlapping FULL refunds both passing.
export function isRefundWithinLimit(opts: {
  totalAmount: number;
  committedOrInFlight: number;
  amount: number;
}): boolean {
  if (!(opts.amount > 0)) return false;
  return round2(opts.committedOrInFlight + opts.amount) <= round2(opts.totalAmount);
}

// New running refunded total after a SUCCEEDED refund.
export function nextRefundedAmount(refundedAmount: number, amount: number): number {
  return round2(refundedAmount + amount);
}

// Full refund reached -> escrow + payment flip to REFUNDED.
export function isFullyRefunded(totalAmount: number, refundedAmount: number): boolean {
  return round2(refundedAmount) >= round2(totalAmount);
}

// --- Payout batch math ---

// Batch total = sum of per-order amounts. Caller pre-filters transfer>0 (see eligibility).
export function batchTotal(amounts: number[]): number {
  return round2(amounts.reduce((s, a) => s + a, 0));
}

// An order is payout-eligible only if its transferAmount is strictly positive.
export function isPayoutEligibleAmount(transferAmount: number): boolean {
  return transferAmount > 0;
}

// Refund correlation prefix (mock pspRef "RF-<refundNo>"); matches the callback key.
export const REFUND_PREFIX = "RF-";

export function isRefundPspRef(pspRef: string): boolean {
  return typeof pspRef === "string" && pspRef.startsWith(REFUND_PREFIX);
}
