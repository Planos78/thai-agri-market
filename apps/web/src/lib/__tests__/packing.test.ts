import { describe, it, expect } from "vitest";
import { reconcile, canSignOff } from "@/lib/packing";

// P6 Flow 6 unit: pure reconcile/sign-off logic (no DB). Variance flag + sign-off gate.

describe("packing: reconcile variance + counts", () => {
  it("all packedQty == expectedQty -> RECONCILED, no variance, counts sum", () => {
    const r = reconcile([
      { expectedQty: 10, packedQty: 10 },
      { expectedQty: 5, packedQty: 5 },
    ]);
    expect(r.expectedCount).toBe(15);
    expect(r.packedCount).toBe(15);
    expect(r.hasVariance).toBe(false);
    expect(r.status).toBe("RECONCILED");
  });

  it("any packedQty != expectedQty -> VARIANCE + hasVariance true", () => {
    const r = reconcile([
      { expectedQty: 10, packedQty: 8 }, // short
      { expectedQty: 5, packedQty: 5 },
    ]);
    expect(r.expectedCount).toBe(15);
    expect(r.packedCount).toBe(13);
    expect(r.hasVariance).toBe(true);
    expect(r.status).toBe("VARIANCE");
  });

  it("over-pack (packed > expected) also flags variance", () => {
    const r = reconcile([{ expectedQty: 5, packedQty: 7 }]);
    expect(r.hasVariance).toBe(true);
    expect(r.status).toBe("VARIANCE");
    expect(r.packedCount).toBe(7);
  });

  it("empty lines -> zero counts, no variance, RECONCILED", () => {
    const r = reconcile([]);
    expect(r.expectedCount).toBe(0);
    expect(r.packedCount).toBe(0);
    expect(r.hasVariance).toBe(false);
    expect(r.status).toBe("RECONCILED");
  });
});

describe("packing: sign-off guard (human-only, audited)", () => {
  it("blocked from OPEN (must reconcile first) -> 409", () => {
    const blocked = canSignOff("OPEN", "anything");
    expect(blocked).not.toBeNull();
    expect(blocked?.status).toBe(409);
  });

  it("already SIGNED_OFF -> 409", () => {
    expect(canSignOff("SIGNED_OFF", "x")?.status).toBe(409);
  });

  it("RECONCILED signs off with or without a note", () => {
    expect(canSignOff("RECONCILED", null)).toBeNull();
    expect(canSignOff("RECONCILED", "note")).toBeNull();
  });

  it("VARIANCE requires a non-empty note -> 422 without, ok with", () => {
    expect(canSignOff("VARIANCE", null)?.status).toBe(422);
    expect(canSignOff("VARIANCE", "")?.status).toBe(422);
    expect(canSignOff("VARIANCE", "   ")?.status).toBe(422); // whitespace-only is empty
    expect(canSignOff("VARIANCE", "short by 2 boxes")).toBeNull();
  });
});
