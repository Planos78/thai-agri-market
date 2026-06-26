import { describe, it } from "vitest";

// Phase 3 DB-dependent acceptance criteria. Run against a live migrated Postgres:
//   npx prisma migrate dev && npx prisma db seed && npx vitest run
// Skipped by default so the unit suite stays DB-free (same convention as integration.test.ts).
describe.skip("phase3 integration (needs DB)", () => {
  it("AC2: webhook rejects an invalid X-Line-Signature with 401 and zero DB writes", () => {});
  it("AC6: PushJob retry — enqueue, fail adapter, sweep, eventual SENT/FAILED with attempts incremented", () => {});
  it("AC7: GET /api/liff/orders returns only the caller's orders (seed two buyers, assert isolation)", () => {});
  it("AC8: consent write persists ConsentLog and flips VerifiedLineUser.consent for pdpa_required", () => {});
});
