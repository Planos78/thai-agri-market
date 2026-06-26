import { describe, it, expect } from "vitest";
import { recomputeAdjustment } from "@/lib/fulfillment";

// take=0.10, vat=0.07 (defaults). Customer-pays: total = subTotal; transfer = total-fee-vat-refundIntent.
describe("adjustment money (item grain)", () => {
  it("REDUCE: refund intent = deltaQty*price; totals recomputed; transfer nets refundIntent", () => {
    // order had 2 lines: (5 x 180)=900 + (2 x 90)=180 = 1080. Reduce line1 by 2 -> qty 3.
    const lines = [
      { quantity: 3, price: 180 }, // post-mutation
      { quantity: 2, price: 90 },
    ];
    const r = recomputeAdjustment({ lines, deltaQty: 2, price: 180, kind: "REDUCE", priorRefundIntent: 0 });
    expect(r.delta).toBe(360); // 2 * 180
    expect(r.subTotal).toBe(720); // 540 + 180
    expect(r.totalAmount).toBe(720);
    expect(r.feeAmount).toBe(72); // 720 * 0.10
    expect(r.vatFeeAmount).toBe(5.04); // 72 * 0.07
    expect(r.refundIntentAmount).toBe(360);
    // transfer = 720 - 72 - 5.04 - 360 = 282.96
    expect(r.transferAmount).toBe(282.96);
  });

  it("REDUCE accumulates onto prior refund intent", () => {
    const lines = [{ quantity: 1, price: 100 }];
    const r = recomputeAdjustment({ lines, deltaQty: 1, price: 100, kind: "REDUCE", priorRefundIntent: 50 });
    expect(r.delta).toBe(100);
    expect(r.refundIntentAmount).toBe(150);
  });

  it("INCREASE: pay-more = deltaQty*price; totals grow; refundIntent unchanged", () => {
    // line1 5->7 (x180), line2 2 (x90). subTotal = 1260 + 180 = 1440.
    const lines = [
      { quantity: 7, price: 180 },
      { quantity: 2, price: 90 },
    ];
    const r = recomputeAdjustment({ lines, deltaQty: 2, price: 180, kind: "INCREASE", priorRefundIntent: 0 });
    expect(r.delta).toBe(360);
    expect(r.subTotal).toBe(1440);
    expect(r.totalAmount).toBe(1440);
    expect(r.feeAmount).toBe(144);
    expect(r.vatFeeAmount).toBe(10.08);
    expect(r.refundIntentAmount).toBe(0);
    // transfer = 1440 - 144 - 10.08 - 0 = 1285.92
    expect(r.transferAmount).toBe(1285.92);
  });

  it("multi-lot recompute is order-wide, not just the changed line", () => {
    const lines = [
      { quantity: 1, price: 200 },
      { quantity: 3, price: 50 },
      { quantity: 4, price: 25 },
    ];
    const r = recomputeAdjustment({ lines, deltaQty: 1, price: 200, kind: "INCREASE", priorRefundIntent: 0 });
    expect(r.subTotal).toBe(450); // 200 + 150 + 100
    expect(r.transferAmount).toBe(450 - 45 - 3.15 - 0);
  });
});
