import { describe, it, expect } from "vitest";
import { calcFee, calcTransferAmount } from "@/lib/money";
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
  isRefundPspRef,
} from "@/lib/settlement";

describe("settlement: take-rate fee math (PlatformConfig rates passed as explicit args)", () => {
  it("fee = subTotal*take; vat = fee*vatRate at 0.10 / 0.125 / 0.15", () => {
    expect(calcFee(2250, 0.1, 0.07)).toEqual({ feeAmount: 225, vatFeeAmount: 15.75 });
    expect(calcFee(2250, 0.125, 0.07)).toEqual({ feeAmount: 281.25, vatFeeAmount: 19.69 });
    expect(calcFee(2250, 0.15, 0.07)).toEqual({ feeAmount: 337.5, vatFeeAmount: 23.63 });
  });
});

describe("settlement: OBS-1 transfer clamp", () => {
  it("full-refund intent -> transfer clamps to 0 (was -240.75)", () => {
    // 2250 - 225 - 15.75 - 2250 = -240.75 -> clamp 0
    expect(calcTransferAmount(2250, 225, 15.75, 2250)).toBe(0);
  });
  it("spec worked example: 900 - 90 - 6.30 - 900 -> 0", () => {
    expect(calcTransferAmount(900, 90, 6.3, 900)).toBe(0);
  });
  it("partial refund still positive: 2070 - 207 - 14.49 - 180 = 1668.51", () => {
    expect(calcTransferAmount(2070, 207, 14.49, 180)).toBe(1668.51);
  });
  it("no refund: 2250 - 225 - 15.75 - 0 = 2009.25", () => {
    expect(calcTransferAmount(2250, 225, 15.75, 0)).toBe(2009.25);
  });
});

describe("settlement: refund amount + invariant", () => {
  it("FULL = totalAmount - refundedAmount", () => {
    expect(fullRefundAmount(900, 0)).toBe(900);
    expect(fullRefundAmount(900, 200)).toBe(700);
  });
  it("over-refund rejected; within-limit accepted (committedOrInFlight = PENDING+SUCCEEDED)", () => {
    expect(isRefundWithinLimit({ totalAmount: 900, committedOrInFlight: 0, amount: 900 })).toBe(true);
    expect(isRefundWithinLimit({ totalAmount: 900, committedOrInFlight: 800, amount: 100 })).toBe(true);
    expect(isRefundWithinLimit({ totalAmount: 900, committedOrInFlight: 800, amount: 200 })).toBe(false);
    expect(isRefundWithinLimit({ totalAmount: 900, committedOrInFlight: 0, amount: 0 })).toBe(false);
  });
  it("BUG-B: in-flight PENDING refund counts toward the limit (two overlapping FULL refunds)", () => {
    // Order paid 2250, refundedAmount=180 (SUCCEEDED), one PENDING FULL of 2070 already in flight.
    // committedOrInFlight = 180 + 2070 = 2250. A second FULL (2070) must be rejected.
    expect(isRefundWithinLimit({ totalAmount: 2250, committedOrInFlight: 2250, amount: 2070 })).toBe(false);
    // First FULL on a clean order: committedOrInFlight=180 (prior PARTIAL), remaining 2070 -> OK.
    expect(isRefundWithinLimit({ totalAmount: 2250, committedOrInFlight: 180, amount: 2070 })).toBe(true);
  });
  it("running refunded total; full -> escrow REFUNDED flag", () => {
    expect(nextRefundedAmount(0, 180)).toBe(180);
    expect(nextRefundedAmount(180, 720)).toBe(900);
    expect(isFullyRefunded(900, 900)).toBe(true);
    expect(isFullyRefunded(900, 180)).toBe(false);
  });
});

describe("settlement: payout batch totals + eligibility", () => {
  it("batch total = sum of per-order amounts (transfer>0 only)", () => {
    expect(batchTotal([2009.25, 1668.51])).toBe(3677.76);
    expect(batchTotal([])).toBe(0);
  });
  it("transfer 0 is not payout-eligible; >0 is", () => {
    expect(isPayoutEligibleAmount(0)).toBe(false);
    expect(isPayoutEligibleAmount(-5)).toBe(false);
    expect(isPayoutEligibleAmount(0.01)).toBe(true);
  });
  it("refund pspRef correlation prefix", () => {
    expect(isRefundPspRef("RF-RF260627001")).toBe(true);
    expect(isRefundPspRef("IP-S260627001")).toBe(false);
  });
});

describe("settlement: state guards (no auto path; terminal-safe)", () => {
  it("payout batch: DRAFT->SUBMITTED->SUCCEEDED/FAILED only", () => {
    expect(canSubmitPayoutBatch("DRAFT")).toBe(true);
    expect(canSubmitPayoutBatch("SUBMITTED")).toBe(false);
    expect(canSettlePayoutBatch("SUBMITTED")).toBe(true);
    expect(canSettlePayoutBatch("SUCCEEDED")).toBe(false);
    expect(canSettlePayoutBatch("FAILED")).toBe(false);
  });
  it("refund: PENDING approvable/settleable/cancellable; terminal not", () => {
    expect(canApproveRefund("PENDING")).toBe(true);
    expect(canApproveRefund("SUCCEEDED")).toBe(false);
    expect(canSettleRefund("PENDING")).toBe(true);
    expect(canSettleRefund("FAILED")).toBe(false);
    expect(canCancelRefund("PENDING")).toBe(true);
    expect(canCancelRefund("CANCELLED")).toBe(false);
  });
});
