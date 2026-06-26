import { describe, it, expect } from "vitest";
import { formatOrderNo, bangkokYymmdd } from "@/lib/order-no";

describe("order-no (AC2 format)", () => {
  it("pads running number to 3 digits", () => {
    expect(formatOrderNo("S", "260626", 7)).toBe("S260626007");
    expect(formatOrderNo("S", "260626", 123)).toBe("S260626123");
  });
  it("bangkok yymmdd is 6 numeric chars", () => {
    expect(bangkokYymmdd(new Date("2026-06-26T03:00:00Z"))).toMatch(/^\d{6}$/);
  });
});
