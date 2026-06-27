import { describe, it, expect } from "vitest";
import type { ClaimStatus } from "@prisma/client";
import { canTransition, assertTransition, isTerminal, TERMINAL } from "@/lib/claim";

// P6 Flow 7 unit: pure claim state-machine transition table. AI may classify/flag but the table
// here governs status transitions; the human-only guard lives at the route (claims.write) — the
// state machine itself never auto-advances and rejects illegal/terminal moves.

describe("claim: valid transitions", () => {
  it("OPEN -> TRIAGING | REJECTED", () => {
    expect(canTransition("OPEN", "TRIAGING")).toBe(true);
    expect(canTransition("OPEN", "REJECTED")).toBe(true);
  });
  it("TRIAGING -> RESOLVED | REJECTED | ESCALATED", () => {
    expect(canTransition("TRIAGING", "RESOLVED")).toBe(true);
    expect(canTransition("TRIAGING", "REJECTED")).toBe(true);
    expect(canTransition("TRIAGING", "ESCALATED")).toBe(true);
  });
  it("ESCALATED -> RESOLVED | REJECTED (food-safety path)", () => {
    expect(canTransition("ESCALATED", "RESOLVED")).toBe(true);
    expect(canTransition("ESCALATED", "REJECTED")).toBe(true);
  });
});

describe("claim: invalid transitions rejected", () => {
  it("OPEN cannot jump straight to RESOLVED/ESCALATED", () => {
    expect(canTransition("OPEN", "RESOLVED")).toBe(false);
    expect(canTransition("OPEN", "ESCALATED")).toBe(false);
  });
  it("ESCALATED cannot go back to TRIAGING/OPEN", () => {
    expect(canTransition("ESCALATED", "TRIAGING")).toBe(false);
    expect(canTransition("ESCALATED", "OPEN")).toBe(false);
  });
});

describe("claim: terminal locks", () => {
  it("RESOLVED and REJECTED are terminal", () => {
    expect(isTerminal("RESOLVED")).toBe(true);
    expect(isTerminal("REJECTED")).toBe(true);
    expect(TERMINAL).toEqual(["RESOLVED", "REJECTED"]);
  });
  it("no transition out of a terminal state", () => {
    const targets: ClaimStatus[] = ["OPEN", "TRIAGING", "RESOLVED", "REJECTED", "ESCALATED"];
    for (const t of targets) {
      expect(canTransition("RESOLVED", t)).toBe(false);
      expect(canTransition("REJECTED", t)).toBe(false);
    }
  });
});

describe("claim: assertTransition codes", () => {
  it("allowed -> null", () => {
    expect(assertTransition("OPEN", "TRIAGING")).toBeNull();
    expect(assertTransition("TRIAGING", "RESOLVED")).toBeNull();
  });
  it("terminal source -> 409", () => {
    expect(assertTransition("RESOLVED", "REJECTED")?.status).toBe(409);
    expect(assertTransition("REJECTED", "RESOLVED")?.status).toBe(409);
  });
  it("illegal (non-terminal) transition -> 409", () => {
    expect(assertTransition("OPEN", "RESOLVED")?.status).toBe(409);
    expect(assertTransition("ESCALATED", "TRIAGING")?.status).toBe(409);
  });
});
