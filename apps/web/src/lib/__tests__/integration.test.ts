import { describe, it } from "vitest";

// DB-dependent acceptance criteria. Run with a live migrated Postgres:
//   npx prisma migrate dev && npx prisma db seed && (wire a test DB) && npx vitest run
// Then implement these against prisma. Skipped by default so unit suite is DB-free.
describe.skip("integration (needs DB)", () => {
  it("AC2: concurrent order creation yields unique orderNo (hammer N parallel creates)", () => {});
  it("AC5: valid callback flips Order=PAID + Payment=COMPLETED/HELD + log, atomically", () => {});
  it("AC6: admin lacking orders.read perm gets 403 from /api/admin/orders", () => {});
  it("AC1: unverified lineUserId cannot create an order (403)", () => {});
});
