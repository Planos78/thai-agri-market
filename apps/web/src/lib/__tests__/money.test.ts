import { describe, it, expect } from "vitest";
import { calcSubTotal, calcFee, calcTransferAmount } from "@/lib/money";

describe("money", () => {
  it("subTotal sums lines + delivery", () => {
    expect(calcSubTotal([{ quantity: 5, price: 180 }, { quantity: 2, price: 90 }], 0)).toBe(1080);
  });
  it("fee = subTotal*take + vat", () => {
    const { feeAmount, vatFeeAmount } = calcFee(1000, 0.1, 0.07);
    expect(feeAmount).toBe(100);
    expect(vatFeeAmount).toBe(7);
  });
  it("transfer = total - fee - vat - refund", () => {
    expect(calcTransferAmount(1000, 100, 7, 0)).toBe(893);
  });
});
