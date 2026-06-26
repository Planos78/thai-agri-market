import { describe, it, expect } from "vitest";
import {
  canDecideReschedule,
  canDecideAdjustment,
  canCancelAdjustment,
  canPayIncrease,
  isIncreasePaymentExpired,
  canTransitionOrder,
  canReview,
  isIncreasePayInvoice,
  INCREASE_PAY_PREFIX,
} from "@/lib/fulfillment";

describe("fulfillment transition guards", () => {
  it("reschedule: only PENDING is decidable", () => {
    expect(canDecideReschedule("PENDING")).toBe(true);
    expect(canDecideReschedule("APPROVED")).toBe(false);
    expect(canDecideReschedule("REJECTED")).toBe(false);
  });

  it("adjustment: only PENDING is decidable / cancellable", () => {
    expect(canDecideAdjustment("PENDING")).toBe(true);
    expect(canCancelAdjustment("PENDING")).toBe(true);
    for (const s of ["APPROVED", "REJECTED", "CANCELLED"]) {
      expect(canDecideAdjustment(s)).toBe(false);
      expect(canCancelAdjustment(s)).toBe(false);
    }
  });

  it("increase-pay: only PENDING is payable", () => {
    expect(canPayIncrease("PENDING")).toBe(true);
    for (const s of ["SUCCEEDED", "EXPIRED", "CANCELLED"]) expect(canPayIncrease(s)).toBe(false);
  });

  it("increase-pay expiry: PENDING past expiresAt expires; terminal never expires", () => {
    const past = new Date(Date.now() - 1000);
    const future = new Date(Date.now() + 1000);
    expect(isIncreasePaymentExpired({ status: "PENDING", expiresAt: past })).toBe(true);
    expect(isIncreasePaymentExpired({ status: "PENDING", expiresAt: future })).toBe(false);
    expect(isIncreasePaymentExpired({ status: "PENDING", expiresAt: null })).toBe(false);
    expect(isIncreasePaymentExpired({ status: "SUCCEEDED", expiresAt: past })).toBe(false);
  });

  it("order lifecycle: PAID->PREPARING->DELIVERED + ->CANCELLED only", () => {
    expect(canTransitionOrder("PAID", "PREPARING")).toBe(true);
    expect(canTransitionOrder("PREPARING", "DELIVERED")).toBe(true);
    expect(canTransitionOrder("PAID", "CANCELLED")).toBe(true);
    expect(canTransitionOrder("PREPARING", "CANCELLED")).toBe(true);
    // illegal
    expect(canTransitionOrder("PAID", "DELIVERED")).toBe(false);
    expect(canTransitionOrder("DELIVERED", "PREPARING")).toBe(false);
    expect(canTransitionOrder("WAITING_PAYMENT", "PREPARING")).toBe(false);
  });

  it("review only when DELIVERED", () => {
    expect(canReview("DELIVERED")).toBe(true);
    for (const s of ["PAID", "PREPARING", "CANCELLED"]) expect(canReview(s)).toBe(false);
  });

  it("invoice prefix disambiguates increase-pay from order", () => {
    expect(isIncreasePayInvoice(`${INCREASE_PAY_PREFIX}S260626001`)).toBe(true);
    expect(isIncreasePayInvoice("S260626001")).toBe(false);
  });
});
