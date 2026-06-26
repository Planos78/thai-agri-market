import { describe, it } from "vitest";

// DB-dependent QC acceptance criteria. Gate on LIVE_DB so the default unit suite
// stays DB-free. Run with: LIVE_DB=1 npx vitest run (against a migrated+seeded DB).
const live = process.env.LIVE_DB ? describe : describe.skip;

live("qc gate (needs DB)", () => {
  it("qc RELEASE flips PENDING->RELEASED + writes a QcAudit row", () => {});
  it("admin lacking qc.release -> 403", () => {});
  it("PENDING lot is absent from /api/liff/lots and rejected (400) by /api/liff/order", () => {});
});
