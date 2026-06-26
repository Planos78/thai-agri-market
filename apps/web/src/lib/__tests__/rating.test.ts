import { describe, it, expect } from "vitest";
import { recomputeRating } from "@/lib/fulfillment";

describe("orchard rating recompute", () => {
  it("0 reviews -> 0", () => {
    expect(recomputeRating([])).toBe(0);
  });
  it("single rating -> itself", () => {
    expect(recomputeRating([4])).toBe(4);
  });
  it("mixed ratings -> rounded average (2dp)", () => {
    expect(recomputeRating([5, 4, 3])).toBe(4);
    expect(recomputeRating([5, 4])).toBe(4.5);
    expect(recomputeRating([5, 4, 4])).toBe(4.33); // 13/3 = 4.333..
  });
});
