import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import { signHmac, verifyHmac, verifyLineSignature } from "@/lib/hmac";

function lineSig(raw: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(raw, "utf8").digest("base64");
}

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

describe("verifyLineSignature (webhook base64 HMAC over raw body)", () => {
  const secret = "channel-secret";
  const raw = JSON.stringify({ events: [{ type: "message", message: { text: "hi" } }] });

  it("accepts a valid base64 signature", () => {
    expect(verifyLineSignature(raw, lineSig(raw, secret), secret)).toBe(true);
  });
  it("rejects a tampered body", () => {
    expect(verifyLineSignature(raw + " ", lineSig(raw, secret), secret)).toBe(false);
  });
  it("rejects the wrong secret", () => {
    expect(verifyLineSignature(raw, lineSig(raw, "other"), secret)).toBe(false);
  });
  it("rejects an empty/length-mismatched signature", () => {
    expect(verifyLineSignature(raw, "", secret)).toBe(false);
    expect(verifyLineSignature(raw, "abc", secret)).toBe(false);
  });
  it("rejects when secret is empty", () => {
    expect(verifyLineSignature(raw, lineSig(raw, secret), "")).toBe(false);
  });
});
