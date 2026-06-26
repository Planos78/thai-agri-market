import { describe, it, expect } from "vitest";
import { isOrderExpired } from "@/lib/orders";

describe("isOrderExpired (AC3)", () => {
  const now = new Date("2026-06-26T12:00:00Z");
  it("expired when past deadline + still waiting", () => {
    expect(isOrderExpired({ status: "WAITING_PAYMENT", paymentExpiredAt: new Date("2026-06-26T11:00:00Z") }, now)).toBe(true);
  });
  it("not expired before deadline", () => {
    expect(isOrderExpired({ status: "WAITING_PAYMENT", paymentExpiredAt: new Date("2026-06-26T13:00:00Z") }, now)).toBe(false);
  });
  it("paid orders never expire", () => {
    expect(isOrderExpired({ status: "PAID", paymentExpiredAt: new Date("2026-06-26T11:00:00Z") }, now)).toBe(false);
  });
});
