import { describe, it, expect } from "vitest";
import { signHmac, verifyHmac } from "@/lib/hmac";

describe("hmac (AC4)", () => {
  it("verifies a valid signature", () => {
    const sig = signHmac("a|100|2000", "s");
    expect(verifyHmac("a|100|2000", sig, "s")).toBe(true);
  });
  it("rejects a tampered payload", () => {
    const sig = signHmac("a|100|2000", "s");
    expect(verifyHmac("a|999|2000", sig, "s")).toBe(false);
  });
  it("rejects a malformed/short signature", () => {
    expect(verifyHmac("a|100|2000", "deadbeef", "s")).toBe(false);
  });
});
