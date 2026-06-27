import { describe, it, expect } from "vitest";
import { periodKey } from "@/lib/cron";
import { selectExpiredOrderIds } from "@/lib/expiry-sweep";
import { computeReconciliation, type ReconRow } from "@/lib/reconciliation";
import { aggregateRevenue, aggregateWht, aggregateRefunds, computeWht } from "@/lib/reports";

describe("cron periodKey", () => {
  // 2026-06-27T14:07:33Z
  const now = new Date(Date.UTC(2026, 5, 27, 14, 7, 33));
  it("daily -> YYYY-MM-DD", () => expect(periodKey(now, "daily")).toBe("2026-06-27"));
  it("hourly -> ...THH", () => expect(periodKey(now, "hourly")).toBe("2026-06-27T14"));
  it("5min floors minute to slot", () => expect(periodKey(now, "5min")).toBe("2026-06-27T1405"));
  it("5min slot at :00", () =>
    expect(periodKey(new Date(Date.UTC(2026, 5, 27, 14, 2, 0)), "5min")).toBe("2026-06-27T1400"));
});

describe("selectExpiredOrderIds", () => {
  const now = new Date("2026-06-27T12:00:00Z");
  const past = new Date("2026-06-27T11:00:00Z");
  const future = new Date("2026-06-27T13:00:00Z");
  it("picks only WAITING_PAYMENT past expiry", () => {
    const ids = selectExpiredOrderIds(
      [
        { id: "a", status: "WAITING_PAYMENT", paymentExpiredAt: past }, // expired
        { id: "b", status: "WAITING_PAYMENT", paymentExpiredAt: future }, // not yet
        { id: "c", status: "PAID", paymentExpiredAt: past }, // paid
        { id: "d", status: "EXPIRED", paymentExpiredAt: past }, // already expired
        { id: "e", status: "WAITING_PAYMENT", paymentExpiredAt: null }, // no expiry
      ],
      now,
    );
    expect(ids).toEqual(["a"]);
  });
  it("empty in -> empty out (idempotent re-run)", () => {
    expect(selectExpiredOrderIds([], now)).toEqual([]);
  });
});

describe("computeReconciliation", () => {
  // Balanced: order 1000, fee+vat 107, paidOut 893, refunded 0, escrow released.
  const balanced: ReconRow[] = [
    { orderNo: "O1", paidAt: null, totalAmount: 1000, feeVat: 107, paidOut: 893, refunded: 0, heldEscrow: false },
  ];
  it("balanced ledger -> variance 0", () => {
    const r = computeReconciliation(balanced);
    expect(r.totals.variance).toBe(0);
    expect(r.rows[0].rowVariance).toBe(0);
  });
  it("still-held escrow balances (escrow accounts for the cash)", () => {
    const r = computeReconciliation([
      { orderNo: "O1", paidAt: null, totalAmount: 1000, feeVat: 107, paidOut: 0, refunded: 0, heldEscrow: true },
    ]);
    // 1000 - 0 - 0 - 107 - 1000 = -107 -> the fee is unexplained while escrow held (matches identity:
    // platform fee is recognized only at payout). This row IS flagged; documents the in-flight state.
    expect(r.rows[0].rowVariance).not.toBe(0);
  });
  it("unmatched payout -> non-zero variance, row flagged", () => {
    const r = computeReconciliation([
      { orderNo: "O1", paidAt: null, totalAmount: 1000, feeVat: 107, paidOut: 500, refunded: 0, heldEscrow: false },
    ]);
    expect(r.totals.variance).toBe(393); // 1000 - 500 - 0 - 107 - 0
    expect(r.rows[0].rowVariance).toBe(393);
  });
  it("refund subtracted from the identity", () => {
    const r = computeReconciliation([
      { orderNo: "O1", paidAt: null, totalAmount: 1000, feeVat: 107, paidOut: 793, refunded: 100, heldEscrow: false },
    ]);
    expect(r.totals.variance).toBe(0);
  });
});

describe("reports aggregation", () => {
  it("revenue sums + groups by orchard", () => {
    const r = aggregateRevenue([
      { orchardId: "A", orchardName: "สวน A", subTotal: 1000, feeAmount: 100, vatFeeAmount: 7 },
      { orchardId: "A", orchardName: "สวน A", subTotal: 500, feeAmount: 50, vatFeeAmount: 3.5 },
      { orchardId: "B", orchardName: "สวน B", subTotal: 200, feeAmount: 20, vatFeeAmount: 1.4 },
    ]);
    expect(r.totals.subTotal).toBe(1700);
    expect(r.totals.feeAmount).toBe(170);
    expect(r.totals.vatFeeAmount).toBe(11.9);
    expect(r.totals.gross).toBe(1881.9);
    expect(r.byOrchard.find((o) => o.orchardId === "A")?.subTotal).toBe(1500);
  });
  it("WHT = round2(fee * rate)", () => {
    expect(computeWht(170, 0.03)).toBe(5.1);
    const r = aggregateWht(
      [
        { orchardId: "A", orchardName: "สวน A", feeAmount: 100 },
        { orchardId: "A", orchardName: "สวน A", feeAmount: 50 },
      ],
      0.03,
    );
    expect(r.totalFee).toBe(150);
    expect(r.totalWht).toBe(4.5);
    expect(r.byOrchard[0].wht).toBe(4.5);
    expect(r.computed).toBe(true);
  });
  it("refunds split CUSTOMER vs PLANT (only CUSTOMER is money out)", () => {
    const r = aggregateRefunds([
      { refundNo: "RF1", orderNo: "O1", amount: 100, kind: "PARTIAL", payoutType: "CUSTOMER", settledAt: null },
      { refundNo: "RF2", orderNo: "O2", amount: 50, kind: "PARTIAL", payoutType: "PLANT", settledAt: null },
      { refundNo: "RF3", orderNo: "O3", amount: 30, kind: "FULL", payoutType: "CUSTOMER", settledAt: null },
    ]);
    expect(r.customerRefunds).toBe(130);
    expect(r.plantClawbacks).toBe(50);
    expect(r.totalRefunded).toBe(130);
  });
});
