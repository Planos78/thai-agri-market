import { describe, it, expect } from "vitest";
import { isBuyable } from "@/lib/lots";

describe("isBuyable", () => {
  it("ACTIVE + RELEASED = true", () => {
    expect(isBuyable({ status: "ACTIVE", qcStatus: "RELEASED" })).toBe(true);
  });
  it("ACTIVE + PENDING = false", () => {
    expect(isBuyable({ status: "ACTIVE", qcStatus: "PENDING" })).toBe(false);
  });
  it("DRAFT + RELEASED = false", () => {
    expect(isBuyable({ status: "DRAFT", qcStatus: "RELEASED" })).toBe(false);
  });
  it("SOLD_OUT + RELEASED = false", () => {
    expect(isBuyable({ status: "SOLD_OUT", qcStatus: "RELEASED" })).toBe(false);
  });
  it("ACTIVE + HOLD = false", () => {
    expect(isBuyable({ status: "ACTIVE", qcStatus: "HOLD" })).toBe(false);
  });
  it("ACTIVE + DOWNGRADED = false", () => {
    expect(isBuyable({ status: "ACTIVE", qcStatus: "DOWNGRADED" })).toBe(false);
  });
});
